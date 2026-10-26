// AIRPLANE_SCREENSAVER_NATIVE
import QtQuick 2.4
import Eos.Window 0.1
import "core.js" as Core
import "map-render.js" as MapRenderer

WebOSWindow {
    id: win
    width: 1920; height: 1080
    windowType: "_WEBOS_WINDOW_TYPE_SCREENSAVER"
    appId: "com.webos.app.screensaver"
    title: "Aircraft Radar"
    visible: true; color: "#0d1011"
    property var config: null
    property var tracker: Core.FlightCore.createFlightTracker()
    property var camera: null
    property var view: null
    property real markerZoomScale: Core.FlightCore.aircraftMarkerScale(view ? view.spanKm : 20)
    property var positions: []
    property var selected: null
    property string selectedId: ""
    property string code: "À ESCUTA"
    property string route: "A RECEBER DADOS"
    property string airline: "TRÁFEGO AÉREO"
    property string aircraft: ""
    property string phase: "À ESCUTA"
    property string distance: "—"
    property string altitude: "—"
    property string altitudeNote: ""
    property string signal: "A RECEBER DADOS"
    property string dataAge: "A LIGAR À FONTE"
    property var extras: ({})
    property var shapes: []
    property var preparedMap: null
    property bool mapLoading: false
    property string metadataKey: ""
    property double metadataRetryAt: 0
    property string routeNote: ""
    property int paintCount: 0
    property double paintTotalMs: 0
    property double paintMaxMs: 0
    property int paintStrokes: 0
    property int paintFeatures: 0
    property bool paintBulk: false
    property bool cameraMoving: true
    property int frames: 0
    property double lastCard: 0
    property double lastFeed: 0
    property bool polling: false
    property double nextPollAt: 0
    property int pollFailures: 0
    property string sourceName: ""
    property string networkState: "starting"
    property var requests: []
    property string localTime: Qt.formatTime(new Date(), "hh:mm")
    FontLoader { id: displayFont; source: "airplane-assets/BarlowCondensed-SemiBold.ttf" }
    FontLoader { id: boldFont; source: "airplane-assets/BarlowCondensed-Bold.ttf" }
    FontLoader { id: monoFont; source: "airplane-assets/IBMPlexMono-Regular.ttf" }
    function tr(pt, en) { return config && config.language === "en" ? en : pt; }
    function formatDistance(km) { var aviation = config && config.units === "aviation"; var n = (aviation ? km / 1.852 : km).toFixed(1); return (config && config.language === "pt" ? n.replace(".", ",") : n) + (aviation ? " NM" : " km"); }
    function get(path, done) {
        var request = new XMLHttpRequest();
        var entry = {request:request,started:Date.now(),finished:false};
        entry.finish = function(data, error) {
            if (entry.finished) return;
            entry.finished = true;
            requests = requests.filter(function(item) { return item !== entry; });
            done(data, error);
        };
        requests = requests.concat([entry]);
        request.onreadystatechange = function() { if (request.readyState === XMLHttpRequest.DONE) {
            var data = null, error = null;
            try { data = JSON.parse(request.responseText); }
            catch (e) { data = null; }
            if (request.status !== 200) { error = {status:request.status,retryAfterMs:data && data.retryAfterMs || 0}; data = null; }
            entry.finish(data, error);
        }};
        try { request.open("GET", "http://127.0.0.1:8895" + path); request.send(); }
        catch (e) { entry.finish(null); }
    }
    function expireRequests() {
        var current = requests.slice(), now = Date.now();
        for (var i = 0; i < current.length; i++) if (now - current[i].started > 19000) {
            current[i].finish(null); current[i].request.abort();
        }
    }
    function poll() {
        if (!config || polling || Date.now() < nextPollAt) return;
        polling = true;
        get("/nearby", function(data, error) {
            polling = false;
            var now = Date.now();
            if (!data) {
                pollFailures++; networkState = error && error.retryAfterMs ? "paused" : "retrying";
                nextPollAt = now + (error && error.retryAfterMs || Math.min(30000, 5000 * Math.pow(2, Math.min(3,pollFailures-1))));
                return;
            }
            try {
                tracker.ingest(Core.FlightCore.readAircraftFeed(data, now), now);
                lastFeed = Math.min(now, data.now > 1e12 ? data.now : data.now * 1000);
                sourceName = data._airplaneSource || "ADSB.fi";
                pollFailures = 0; networkState = "live"; nextPollAt = now + 15000;
            }
            catch (e) { networkState = "retrying"; nextPollAt = now + 15000; }
        });
    }
    function loadMap() {
        if (mapLoading || !base.available) return;
        mapLoading = true;
        var ctx = base.getContext("2d"), nativePaths = ctx && 'path' in ctx;
        get(nativePaths ? "/map?native=1" : "/map", function(data) {
            if (!data) { mapLoading = false; return; }
            shapes = data.shapes; preparedMap = MapRenderer.NativeMap.prepare(shapes); base.requestPaint();
        });
    }
    function refreshMetadata(now) {
        if (!selected) return;
        var key = selected.id + "/" + (selected.callsign || "");
        if (key === metadataKey && now < metadataRetryAt) return;
        if (key !== metadataKey) { metadataKey = key; extras = {pending:true}; lastCard = 0; }
        metadataRetryAt = now + 30000;
        var requestKey = key;
        get("/metadata?id=" + selected.id.replace("~", "") + "&callsign=" + encodeURIComponent(selected.callsign || ""), function(data) {
            if (metadataKey !== requestKey) return;
            var p = data && data.response || {}, r = p.flightroute || {}, a = p.aircraft || {};
            function airport(point) { return point ? point.municipality || point.iata_code || point.icao_code || point.name || "" : ""; }
            var origin = airport(r.origin), destination = airport(r.destination);
            extras = {route:origin && destination ? origin + " → " + destination : "", airline:r.airline ? r.airline.name : "", icaoType:Core.FlightCore.normalizeIcaoType(a.icao_type), model:a.type || a.icao_type || "", unavailable:!data};
            metadataRetryAt = Date.now() + (extras.route ? 900000 : data ? 120000 : 30000);
            lastCard = 0;
        });
    }
    function tick() {
        if (!config || !camera) return;
        var now = Date.now();
        positions = tracker.positions(now).filter(function(p) { return Core.FlightCore.distanceKm(config.location, p) <= config.radiusKm; }).slice(0, 40);
        selected = Core.FlightCore.selectAircraft(positions, config.location, selectedId);
        view = camera.update(selected, {width: map.width, height: map.height}, now);
        frames++;
        cameraMoving = Math.abs(view.spanKm - view.targetSpanKm) > .01;
        if (selected && selected.id !== selectedId) { selectedId = selected.id; lastCard = 0; }
        if (!selected) { selectedId = ""; metadataKey = ""; extras = {}; }
        refreshMetadata(now);
        if (now - lastCard > 950) {
            lastCard = now; phase = config.language === "en" ? ({"À ESCUTA":"LISTENING", "PASSAGEM PRÓXIMA":"NEARBY FLIGHT", "SOBRE A ZONA":"OVERHEAD", "EM APROXIMAÇÃO":"APPROACHING", "A AFASTAR-SE":"DEPARTING"}[view.phase] || view.phase) : view.phase;
            signal = networkState === "paused" ? tr("FONTES EM PAUSA · TENTATIVA EM ", "SOURCES PAUSED · RETRY IN ") + Math.max(0,Math.ceil((nextPollAt-now)/1000)) + " s" : networkState === "retrying" ? tr("A RECUPERAR DADOS", "RECONNECTING") : sourceName ? tr("SINAL RECEBIDO · ", "SIGNAL RECEIVED · ") + sourceName : tr("A RECEBER DADOS", "RECEIVING DATA");
            dataAge = lastFeed ? tr("ÚLTIMA ATUALIZAÇÃO HÁ ", "LAST UPDATE ") + Math.floor((now - lastFeed) / 1000) + " s" : tr("A LIGAR À FONTE", "CONNECTING TO SOURCE");
            code = selected ? selected.callsign || selected.id.toUpperCase() : tr("À ESCUTA", "LISTENING");
            route = selected ? (extras.route || selected.registration || selected.model || tr("VOO DETETADO", "AIRCRAFT DETECTED")) : tr("SEM PASSAGENS PRÓXIMAS", "NO NEARBY AIRCRAFT");
            routeNote = selected ? (extras.route ? tr("ROTA PUBLICADA · ADSBdb", "PUBLISHED ROUTE · ADSBdb") : extras.pending ? tr("A CONSULTAR ROTA", "LOOKING UP ROUTE") : extras.unavailable ? tr("CONSULTA DE ROTA INDISPONÍVEL", "ROUTE LOOKUP UNAVAILABLE") : tr("ROTA NÃO PUBLICADA PELA FONTE", "ROUTE NOT PUBLISHED")) : "";
            airline = selected ? (extras.airline || tr("TRÁFEGO AÉREO", "AIR TRAFFIC")) : tr("TRÁFEGO AÉREO", "AIR TRAFFIC");
            aircraft = selected ? (extras.model || selected.model || selected.registration || "") : "";
            distance = selected ? formatDistance(Core.FlightCore.distanceKm(config.location, selected)) : "—";
            var altitudeState = selected ? Core.FlightCore.altitudeDisposition(selected.altitudeM) : "unavailable";
            altitude = altitudeState === "valid" ? (config.units === "aviation" ? Math.round(selected.altitudeM * 3.280839895) + " ft" : Math.round(selected.altitudeM) + " m") : "—";
            altitudeNote = altitudeState === "below-zero" ? tr("Leitura barométrica abaixo de zero", "Barometric reading below zero") : "";
        }
        var ratio = view.width * 1.2 / base.frameWidth;
        if (base.frameWidth === 0 || ratio > 1.1 || ratio < .82) {
            base.frameWidth = view.width * 1.2; base.frameHeight = view.height * 1.2;
            base.frameX = view.x - view.width * .1; base.frameY = view.y - view.height * .1;
            base.requestPaint();
        }
        // Keep recorded paths in a bounded texture. The compositor moves that
        // texture with the camera; only the live two-point connector animates.
        var trailRatio = view.width * 1.2 / trail.frameWidth;
        if (!trail.frameWidth || trailRatio > 1.1 || trailRatio < .82 ||
                view.x < trail.frameX || view.y < trail.frameY ||
                view.x + view.width > trail.frameX + trail.frameWidth ||
                view.y + view.height > trail.frameY + trail.frameHeight ||
                now - trail.lastPaintAt >= 1000 || selectedId !== trail.paintedSelectedId) {
            trail.frameWidth = view.width * 1.2; trail.frameHeight = view.height * 1.2;
            trail.frameX = view.x - view.width * .1; trail.frameY = view.y - view.height * .1;
            trail.lastPaintAt = now; trail.paintedSelectedId = selectedId;
            trail.requestPaint();
        }
    }
    Text { x: 50; y: 24; text: win.tr("AVIÃO NAS PROXIMIDADES", "AIRCRAFT NEARBY"); color: "#f3efe7"; font.family: boldFont.name; font.pixelSize: 58; font.letterSpacing: 3 }
    Text { anchors.right: parent.right; anchors.rightMargin: 60; y: 34; text: win.localTime; color: "#f3efe7"; font.family: monoFont.name; font.pixelSize: 48 }
    Rectangle { x: 50; y: 108; width: 1820; height: 1; color: "#60757e" }
    Item {
        id: map
        x: 0; y: 110; width: 1370; height: 904; clip: true
        Rectangle { anchors.fill: parent; color: "#11191d" }
        Canvas {
            id: base
            // QML canvasSize is a logical drawing area, not an HTML-style
            // backing resolution. Scale the entire bounded item explicitly.
            width: 1280
            height: width * map.height / map.width
            canvasSize: Qt.size(width, height)
            property real frameWidth: 0
            property real frameHeight: 0
            property real frameX: 0
            property real frameY: 0
            x: win.view ? (frameX - win.view.x) / win.view.width * map.width : 0
            y: win.view ? (frameY - win.view.y) / win.view.height * map.height : 0
            transformOrigin: Item.TopLeft
            onAvailableChanged: if (available) win.loadMap()
            scale: win.view && frameWidth ? frameWidth / win.view.width * map.width / width : 1
            onPaint: {
                if (!frameWidth || !win.preparedMap) return;
                var started = Date.now();
                var result = MapRenderer.NativeMap.paint(getContext("2d"), win.preparedMap,
                    {x:frameX,y:frameY,width:frameWidth,height:frameHeight}, canvasSize.width, canvasSize.height);
                var elapsed = Date.now() - started;
                win.paintCount++; win.paintTotalMs += elapsed; win.paintMaxMs = Math.max(win.paintMaxMs, elapsed);
                win.paintStrokes = result.strokes; win.paintFeatures = result.features;
                win.paintBulk = result.bulkPaths;
            }
        }
        Canvas {
            id: trail
            width: 1280
            height: width * map.height / map.width
            canvasSize: Qt.size(width, height)
            property real frameWidth: 0
            property real frameHeight: 0
            property real frameX: 0
            property real frameY: 0
            property double lastPaintAt: 0
            property string paintedSelectedId: ""
            x: win.view ? (frameX - win.view.x) / win.view.width * map.width : 0
            y: win.view ? (frameY - win.view.y) / win.view.height * map.height : 0
            transformOrigin: Item.TopLeft
            scale: win.view && frameWidth ? frameWidth / win.view.width * map.width / width : 1
            onPaint: {
                var ctx = getContext("2d");
                ctx.setTransform(1,0,0,1,0,0);
                ctx.clearRect(0, 0, width, height);
                if (!frameWidth || !win.view) return;
                var sx = width / frameWidth, sy = height / frameHeight;
                ctx.setTransform(sx, 0, 0, sy, -frameX * sx, -frameY * sy);
                var trails = win.tracker.trails(Date.now());
                for (var j = 0; j < trails.length; j++) {
                    var segment = trails[j], points = segment.points;
                    if (points.length < 2) continue;
                    ctx.beginPath();
                    for (var i = 0; i < points.length; i++) {
                        if (points[i].worldX === undefined) {
                            var world = Core.FlightCore.projectFlightNear(points[i], trail.frameX + trail.frameWidth / 2);
                            points[i].worldX = world.x; points[i].worldY = world.y;
                        }
                        if (i === 0) ctx.moveTo(points[i].worldX, points[i].worldY);
                        else ctx.lineTo(points[i].worldX, points[i].worldY);
                    }
                    var chosen = win.selected && segment.flightId === win.selected.id;
                    ctx.globalAlpha = segment.opacity * (chosen ? .72 : .28);
                    ctx.strokeStyle = chosen ? "#ff8b42" : "#b96b3d";
                    ctx.lineWidth = (chosen ? 3 : 2) / (sx * scale);
                    ctx.lineJoin = "round"; ctx.stroke();
                }
                ctx.globalAlpha = 1; ctx.setTransform(1,0,0,1,0,0);
            }
        }
        Rectangle {
            id: liveTrail
            property var previous: win.selected && win.selected.history.length ? win.selected.history[win.selected.history.length - 1] : null
            property var startPoint: previous && win.view ? Core.FlightCore.cameraPoint(previous, win.view, {width:map.width,height:map.height}) : {x:0,y:0}
            property var endPoint: win.selected && win.view ? Core.FlightCore.cameraPoint(win.selected, win.view, {width:map.width,height:map.height}) : startPoint
            property real dx: endPoint.x - startPoint.x
            property real dy: endPoint.y - startPoint.y
            visible: !!previous
            x: startPoint.x; y: startPoint.y - height / 2
            width: Math.sqrt(dx * dx + dy * dy); height: 3
            rotation: Math.atan2(dy, dx) * 180 / Math.PI
            transformOrigin: Item.Left
            color: "#ff8b42"; opacity: .72
        }
        Repeater {
            id: aircraftMarkers
            model: win.positions.length
            Image {
                property var plane: win.positions[index]
                property var point: win.view && plane ? Core.FlightCore.cameraPoint(plane, win.view, {width:map.width,height:map.height}) : {x:-50,y:-50}
                x: point.x - width / 2; y: point.y - height / 2
                property string iconKey: Core.FlightCore.resolveAircraftIcon(plane ? plane.icaoType : "", plane && plane.id === win.selectedId && win.metadataKey === plane.id + "/" + (plane.callsign || "") ? win.extras.icaoType : "").key
                property string failedKey: ""
                property string iconBase: Qt.resolvedUrl("airplane-assets/")
                source: iconBase + (failedKey === iconKey ? "aircraft" : iconKey) + ".png"
                onStatusChanged: if (status === Image.Error && failedKey !== iconKey) { failedKey = iconKey; console.log("Aircraft icon failed: " + iconKey); }
                asynchronous: false
                width: (plane && plane.id === win.selectedId ? 72 : 40) * win.markerZoomScale; height: width
                sourceSize: Qt.size(width, height); smooth: true
                rotation: plane && plane.heading !== null ? plane.heading : 0
                opacity: plane && plane.stale ? .15 : plane && plane.id === win.selectedId ? 1 : .5
            }
        }
        Item {
            id: homeMarker
            property var point: win.view && win.config ? Core.FlightCore.cameraPoint(win.config.location, win.view, {width:map.width,height:map.height}) : {x:-50,y:-50}
            x: point.x
            y: point.y
            Rectangle { x: -7; y: -7; width: 14; height: 14; radius: 7; color: "#94cea6" }
            Text { x: 19; y: -14; text: win.tr("REFERÊNCIA", "REFERENCE"); color: "#94cea6"; font.family: boldFont.name; font.pixelSize: 28 }
        }
        Rectangle {
            x: 40; y: 28; width: phaseLabel.width + 48; height: 58; radius: 29
            color: "#0d1011"; border.color: "#94cea6"; border.width: 2
            Text { id: phaseLabel; x: 24; anchors.verticalCenter: parent.verticalCenter; text: win.phase; color: "#94cea6"; font.family: boldFont.name; font.pixelSize: 30 }
        }
        Text { anchors.right: parent.right; anchors.rightMargin: 42; y: 40; text: win.view ? win.formatDistance(win.view.spanKm).toUpperCase() + win.tr(" DE MAPA", " MAP WIDTH") : ""; color: "#c2d0d6"; font.family: monoFont.name; font.pixelSize: 20 }
    }
    Rectangle { x: 1370; y: 110; width: 6; height: 940; color: "#ff711c" }
    Item {
        x: 1410; y: 0; width: 470; height: 1080
        Text { y: 132; height: 150; text: win.code; color: "#ff711c"; font.family: boldFont.name; font.pixelSize: 152; width:470; fontSizeMode: Text.Fit; minimumPixelSize:55 }
        Rectangle { y: 302; width: 470; height: 1; color: "#60757e" }
        Text { y: 324; height: 98; text: win.route.toUpperCase(); color: "#f3efe7"; font.family:boldFont.name; font.pixelSize:66; width:470; wrapMode:Text.WordWrap; fontSizeMode:Text.Fit; minimumPixelSize:32; maximumLineCount:2; elide:Text.ElideRight; verticalAlignment:Text.AlignVCenter }
        Rectangle { y: 426; width: 470; height: 1; color: "#60757e" }
        Text { y: 452; height: 46; text: win.routeNote; color:"#a1b5c0"; font.family:monoFont.name; font.pixelSize:20; width:470; wrapMode:Text.WordWrap; maximumLineCount:2; elide:Text.ElideRight }
        Text { y: 500; height: 70; text: win.airline.toUpperCase(); color: "#f3efe7"; font.family:boldFont.name; font.pixelSize:52; width:470; fontSizeMode:Text.Fit; minimumPixelSize:30; wrapMode:Text.WordWrap; maximumLineCount:2; elide:Text.ElideRight }
        Text { y: 578; height: 50; text: win.aircraft.toUpperCase(); color: "#f3efe7"; font.family:boldFont.name; font.pixelSize:48; width:470; fontSizeMode:Text.Fit; minimumPixelSize:28; elide:Text.ElideRight }
        Rectangle { y: 650; width: 470; height: 1; color: "#60757e" }
        Text { y: 678; text: win.tr("DISTÂNCIA", "DISTANCE"); color:"#94cea6"; font.family:displayFont.name; font.pixelSize:28; font.letterSpacing:2 }
        Text { y: 710; height: 100; width:470; text: win.distance; color:"#ff711c"; font.family:boldFont.name; font.pixelSize:92; fontSizeMode:Text.Fit; minimumPixelSize:50 }
        Text { y: 818; text: win.tr("ALTITUDE BAROMÉTRICA", "BAROMETRIC ALTITUDE"); color:"#94cea6"; font.family:displayFont.name; font.pixelSize:28; font.letterSpacing:2 }
        Text { y: 850; height: 100; width:470; text: win.altitude; color:"#ff711c"; font.family:boldFont.name; font.pixelSize:92; fontSizeMode:Text.Fit; minimumPixelSize:50 }
        Rectangle { y: 952; width: 470; height: 1; color: "#60757e" }
        Text { y: 950; width:470; height:20; text:win.altitudeNote; color:"#a1b5c0"; font.family:monoFont.name; font.pixelSize:16; elide:Text.ElideRight }
        Text { y: 970; width:470; height:48; text: win.signal; color:"#a1b5c0"; font.family:monoFont.name; font.pixelSize:18; wrapMode:Text.WordWrap; maximumLineCount:2; elide:Text.ElideRight }
        Text { y: 1010; width:470; text: win.dataAge; color:"#a1b5c0"; font.family:monoFont.name; font.pixelSize:17 }
        Text { y: 1040; width:470; height:30; text: win.tr("Posição estimada entre observações", "Position estimated between observations"); color:"#a1b5c0"; font.family:monoFont.name; font.pixelSize:17; wrapMode:Text.WordWrap }
    }
    Text { x:40; y:1018; text:"© OpenStreetMap contributors · © OpenMapTiles · OpenFreeMap"; color:"#a1b5c0"; font.family:monoFont.name; font.pixelSize:16 }
    Text { x:40; y:1040; text:"adsb.fi · https://adsb.fi · ADSB.lol · ADSBdb"; color:"#a1b5c0"; font.family:monoFont.name; font.pixelSize:16 }
    Timer { interval: win.positions.length || win.cameraMoving ? 33 : 250; running: win.visible; repeat: true; onTriggered: win.tick() }
    Timer { interval: 1000; running: win.visible; repeat: true; onTriggered: {
        var currentTime = Qt.formatTime(new Date(), "hh:mm");
        if (win.localTime !== currentTime) win.localTime = currentTime;
        win.poll();
    } }
    Timer { interval: 5000; running: win.visible; repeat: true; onTriggered: {
        win.expireRequests();
        var ready = 0, failed = 0;
        for (var i = 0; i < aircraftMarkers.count; i++) {
            var marker = aircraftMarkers.itemAt(i);
            if (marker && marker.status === Image.Ready) ready++;
            if (marker && (marker.status === Image.Error || marker.failedKey)) failed++;
        }
        win.get("/beat?frames="+win.frames+"&loaded="+(win.shapes.length?1:0)+"&paints="+win.paintCount+"&paintTotal="+win.paintTotalMs+"&paintMax="+win.paintMaxMs+"&strokes="+win.paintStrokes+"&features="+win.paintFeatures+"&bulk="+(win.paintBulk?1:0)+"&route="+(win.extras.route?1:0)+"&count="+win.positions.length+"&iconsReady="+ready+"&iconsError="+failed+"&live="+(win.lastFeed?1:0)+"&age="+(win.lastFeed?Math.floor((Date.now()-win.lastFeed)/1000):"none"),function(data){});
    } }
    Component.onCompleted: {
        get("/config", function(data) { if (!data) return; config = Core.FlightCore.normalizeFlightConfig(data); camera = Core.FlightCore.createFlightCamera(config.location, config.radiusKm); poll(); });
        loadMap();
    }
    Component.onDestruction: tracker.clear()
}
