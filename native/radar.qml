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
    visible: true; color: backgroundColor
    property var config: null
    property string theme: config && config.theme ? config.theme : "classic"
    property bool eva: theme === "evangelion"
    property bool noir: theme === "noir"
    property bool modern: theme !== "classic" && !eva && !noir
    property color backgroundColor: noir ? "#10151c" : theme === "coast" ? "#faf6ed" : theme === "lavender" ? "#e5dff8" : theme === "sage" ? "#e4ecd9" : "#0d1011"
    property color foregroundColor: noir ? "#dde2e6" : theme === "coast" ? "#10213e" : theme === "lavender" ? "#381347" : theme === "sage" ? "#123d30" : "#f3efe7"
    property color accentColor: noir ? "#d9e0e5" : eva ? "#ff3017" : theme === "coast" ? "#1357cb" : theme === "lavender" ? "#ef695f" : theme === "sage" ? "#e60052" : "#ff711c"
    property color secondaryColor: noir ? "#a7b0b8" : theme === "coast" ? "#435875" : theme === "lavender" ? "#604773" : theme === "sage" ? "#48695b" : "#a1b5c0"
    property color mapBackground: noir ? "#0b121a" : theme === "coast" ? "#faf6ed" : theme === "lavender" ? "#e5dff8" : theme === "sage" ? "#e4ecd9" : "#11191d"
    onThemeChanged: { if (base.available) base.requestPaint(); if (trail.available) trail.requestPaint(); }
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
    FontLoader { id: japaneseFont; source: "airplane-assets/NotoSansJP-Header.ttf" }
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
        // The circular viewport needs extra edge room for markers on diagonals.
        if (theme === "lavender") {
            view.x -= view.width * .075; view.y -= view.height * .075;
            view.width *= 1.15; view.height *= 1.15;
            view.spanKm *= 1.15; view.targetSpanKm *= 1.15;
        }
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
    // Each display keeps its own title scale and alignment from the chosen visual.
    Text {
        visible: !win.eva && !win.noir
        x: win.theme === "coast" ? 188 : 70; y: win.modern ? 25 : 24
        width: win.modern ? 1250 : implicitWidth; height: 80
        text: win.modern ? win.tr("Avião nas proximidades", "Aircraft nearby") : win.tr("AVIÃO NAS PROXIMIDADES", "AIRCRAFT NEARBY")
        color: win.foregroundColor; font.family: win.modern ? "sans-serif" : boldFont.name
        font.bold: win.modern; font.pixelSize: win.theme === "lavender" ? 82 : win.modern ? 68 : 58
        font.letterSpacing: win.modern ? 0 : 3; fontSizeMode: Text.Fit; minimumPixelSize: 32
    }
    // Reuse the aircraft asset in the coast title instead of inventing an icon.
    Image {
        visible: win.theme === "coast"; x: 70; y: 29; width: 85; height: 70
        source: Qt.resolvedUrl("airplane-assets/aircraft.png"); fillMode: Image.PreserveAspectFit
        rotation: 90; layer.enabled: visible
        layer.effect: ShaderEffect {
            property variant source; property color tint: "#10213e"
            fragmentShader: "varying highp vec2 qt_TexCoord0; uniform sampler2D source; uniform lowp vec4 tint; uniform lowp float qt_Opacity; void main() { lowp float a = texture2D(source, qt_TexCoord0).a * tint.a; gl_FragColor = vec4(tint.rgb * a, a) * qt_Opacity; }"
        }
    }
    Text {
        visible: !win.eva && !win.noir; anchors.right: parent.right; anchors.rightMargin: 72; y: 27
        text: win.localTime; color: win.foregroundColor; font.family: win.modern ? "sans-serif" : monoFont.name
        font.pixelSize: win.modern ? 57 : 48
    }
    Rectangle { visible: win.theme === "sage"; x: 895; y: 60; width: 760; height: 2; color: win.secondaryColor; opacity: .7 }
    Rectangle { visible: !win.modern && !win.eva && !win.noir; x: 50; y: 108; width: 1820; height: 1; color: "#60757e" }
    // Red bordered blocks, compact legends and the requested Japanese heading.
    Item {
        visible: win.eva; x: 12; y: 10; width: 1896; height: 170
        Rectangle { anchors.fill: parent; color: "#070707"; border.color: "#ff3017"; border.width: 2 }
        Rectangle { x: 155; y: 0; width: 2; height: parent.height; color: "#ff3017" }
        Text { x: 52; y: 28; width: 96; height: 70; text: "NERV"; color: "#ff3017"; font.family: boldFont.name; font.pixelSize: 48; fontSizeMode: Text.Fit; minimumPixelSize: 32 }
        Text { x: 55; y: 103; width: 94; height: 42; text: "///"; color: "#ff3017"; font.family: monoFont.name; font.pixelSize: 22 }
        Text { x: 172; y: 8; width: 850; height: 130; text: win.tr("AVIÃO NAS PROXIMIDADES", "AIRCRAFT NEARBY"); color: "#f3efe7"; font.family: boldFont.name; font.pixelSize: 110; fontSizeMode: Text.Fit; minimumPixelSize: 50; elide: Text.ElideRight }
        Text { x: 172; y: 135; width: 850; text: win.tr("TRÁFEGO AÉREO EM TEMPO REAL", "LIVE AIR TRAFFIC"); color: "#f3efe7"; font.family: monoFont.name; font.pixelSize: 18; font.letterSpacing: 8 }
        Text { x: 1060; y: 37; width: 515; height: 68; text: "くたばれ、クソ野郎"; color: "#ff3017"; font.family: japaneseFont.name; font.bold: true; font.pixelSize: 58; fontSizeMode: Text.Fit; minimumPixelSize: 30 }
        Text { x: 1060; y: 110; width: 500; text: win.tr("PROXIMIDADE DE AERONAVE", "AIRCRAFT NEARBY"); color: "#ff3017"; font.family: monoFont.name; font.pixelSize: 17; font.letterSpacing: 3 }
        Rectangle { x: 1587; y: 0; width: 2; height: parent.height; color: "#ff3017" }
        Text { x: 1604; y: 20; text: win.tr("HORA LOCAL", "LOCAL TIME"); color: "#f3efe7"; font.family: monoFont.name; font.pixelSize: 18 }
        Text { x: 1600; y: 49; width: 280; height: 100; text: win.localTime; color: "#ff3017"; font.family: boldFont.name; font.pixelSize: 112; fontSizeMode: Text.Fit; minimumPixelSize: 55 }
        Repeater { model: 5; Rectangle { x: 8 + index * 8; y: 8; width: 5; height: 148; rotation: 22; color: "#ff3017"; clip: true } }
    }
    Item {
        id: map
        x: win.noir ? 0 : win.eva ? 100 : win.theme === "coast" ? 700 : win.theme === "lavender" ? 170 : 0; y: win.noir ? 0 : win.eva ? 193 : win.theme === "lavender" ? 155 : 110; width: win.noir ? 1920 : win.eva ? 1280 : win.theme === "coast" ? 1220 : win.theme === "lavender" ? 825 : win.theme === "sage" ? 1330 : 1370; height: win.noir ? 910 : win.eva ? 800 : win.theme === "coast" ? 970 : win.theme === "lavender" ? 825 : win.theme === "sage" ? 750 : 904; clip: true
        Rectangle { anchors.fill: parent; color: win.mapBackground }
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
                    {x:frameX,y:frameY,width:frameWidth,height:frameHeight}, canvasSize.width, canvasSize.height, win.theme);
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
                    ctx.strokeStyle = (win.modern || win.eva || win.noir) ? String(win.accentColor) : (chosen ? "#ff8b42" : "#b96b3d");
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
            color: (win.modern || win.eva || win.noir) ? win.accentColor : "#ff8b42"; opacity: .72
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
                // Reuse the existing silhouette alpha; theme tint does not
                // change aircraft selection, orientation, or icon fallback.
                layer.enabled: win.modern || win.eva || win.noir
                layer.effect: ShaderEffect {
                    property variant source
                    property color tint: win.accentColor
                    fragmentShader: "varying highp vec2 qt_TexCoord0; uniform sampler2D source; uniform lowp vec4 tint; uniform lowp float qt_Opacity; void main() { lowp float a = texture2D(source, qt_TexCoord0).a * tint.a; gl_FragColor = vec4(tint.rgb * a, a) * qt_Opacity; }"
                }
                rotation: plane && plane.heading !== null ? plane.heading : 0
                opacity: plane && plane.stale ? .15 : plane && plane.id === win.selectedId ? 1 : .5
            }
        }
        Item {
            id: homeMarker
            property var point: win.view && win.config ? Core.FlightCore.cameraPoint(win.config.location, win.view, {width:map.width,height:map.height}) : {x:-50,y:-50}
            x: point.x
            y: point.y
            Rectangle { x: -7; y: -7; width: 14; height: 14; radius: 7; color: win.noir ? win.foregroundColor : win.eva ? "#f4e255" : win.modern ? win.foregroundColor : "#94cea6" }
            Text { x: 19; y: -14; text: win.tr("REFERÊNCIA", "REFERENCE"); color: win.noir ? win.foregroundColor : win.eva ? "#f4e255" : win.modern ? win.foregroundColor : "#94cea6"; font.family: (win.modern || win.noir) ? "sans-serif" : boldFont.name; font.bold: win.modern; font.pixelSize: win.noir ? 22 : 28 }
        }
        Text {
            visible: win.theme === "sage"
            property var point: win.selected && win.view ? Core.FlightCore.cameraPoint(win.selected, win.view, {width:map.width,height:map.height}) : {x:35,y:30}
            x: Math.min(map.width - width - 18, Math.max(18, point.x + 36))
            y: Math.min(map.height - height - 18, Math.max(18, point.y - 12))
            width: 260; text: win.phase; color: win.foregroundColor
            font.family: "sans-serif"; font.bold: true; font.pixelSize: 27; elide: Text.ElideRight
        }
        Rectangle {
            x: 40; y: 28; width: phaseLabel.width + 48; height: 58; radius: win.eva ? 0 : 29
            visible: !win.modern && !win.noir
            color: "#0d1011"; border.color: win.eva ? win.accentColor : "#94cea6"; border.width: 2
            Text { id: phaseLabel; x: 24; anchors.verticalCenter: parent.verticalCenter; text: win.phase; color: win.eva ? win.accentColor : "#94cea6"; font.family: boldFont.name; font.pixelSize: 30 }
        }
        Text { visible: win.theme !== "lavender" && !win.noir; anchors.right: parent.right; anchors.rightMargin: 42; y: 40; text: win.view ? win.formatDistance(win.view.spanKm).toUpperCase() + win.tr(" DE MAPA", " MAP WIDTH") : ""; color: win.modern ? win.foregroundColor : "#c2d0d6"; font.family: monoFont.name; font.pixelSize: 20 }
    }
    // Noir: the live map occupies the whole composition; live flight fields
    // remain in a restrained bottom telemetry strip rather than a side panel.
    Item {
        visible: win.noir; x: 0; y: 0; width: 1920; height: 910
        Rectangle { x: 0; y: 0; width: 1920; height: 86; color: "#10151c"; opacity: .35 }
        Text { x: 42; y: 27; width: 455; text: win.tr("AVIÃO NAS PROXIMIDADES", "AIRCRAFT NEARBY"); color: "#c9cfd4"; font.family: "sans-serif"; font.pixelSize: 22; font.letterSpacing: 4; elide: Text.ElideRight }
        Rectangle { x: 497; y: 41; width: 1280; height: 1; color: "#8b949d"; opacity: .36 }
        Text { x: 1790; y: 23; width: 90; text: win.localTime; color: "#c9cfd4"; horizontalAlignment: Text.AlignRight; font.family: "sans-serif"; font.pixelSize: 25 }
        Rectangle { x: 64; y: 105; width: Math.min(430, noirPhase.implicitWidth + 48); height: 43; radius: 22; color: "#111820"; opacity: .95; border.color: "#79838c"; border.width: 1
            Text { id: noirPhase; x: 24; anchors.verticalCenter: parent.verticalCenter; width: parent.width - 48; text: win.phase; color: "#d6dce1"; font.family: "sans-serif"; font.pixelSize: 19; font.letterSpacing: 2; elide: Text.ElideRight }
        }
        // Network problems need a readable state even if the compact status
        // cell in the bottom strip has to shorten a long message.
        Text { visible: win.networkState !== "live"; x: 1320; y: 98; width: 550; height: 38; text: win.signal; color: "#e4e8ea"; font.family: "sans-serif"; font.pixelSize: 22; horizontalAlignment: Text.AlignRight; elide: Text.ElideRight }
    }
    Item {
        // Two lines of live data plus an attribution line remain readable on
        // a TV while preserving the subdued, map-first composition.
        visible: win.noir; x: 0; y: 910; width: 1920; height: 170
        Rectangle { anchors.fill: parent; color: "#0b1118"; opacity: .96 }
        Rectangle { x: 24; y: 0; width: 1872; height: 1; color: "#7f8992"; opacity: .4 }
        Repeater { model: [195, 705, 1030, 1315]; Rectangle { x: modelData; y: 12; width: 1; height: 48; color: "#7f8992"; opacity: .42 } }
        Repeater { model: [220, 480, 690, 1055, 1405]; Rectangle { x: modelData; y: 75; width: 1; height: 39; color: "#7f8992"; opacity: .35 } }
        Text { x: 28; y: 8; width: 155; height: 52; text: win.code; color: win.foregroundColor; font.family: "sans-serif"; font.pixelSize: 29; fontSizeMode: Text.Fit; minimumPixelSize: 18; elide: Text.ElideRight; verticalAlignment: Text.AlignVCenter }
        // A long route scrolls gently only when necessary, so both airport
        // names remain readable without colliding with neighbouring fields.
        Item {
            id: noirRouteBox; x: 205; y: 8; width: 490; height: 52; clip: true
            Text {
                id: noirRoute; width: Math.max(noirRouteBox.width, implicitWidth); height: parent.height
                onImplicitWidthChanged: if (implicitWidth <= noirRouteBox.width) x = 0
                text: win.route; color: win.foregroundColor; font.family: "sans-serif"; font.pixelSize: 27; verticalAlignment: Text.AlignVCenter
                SequentialAnimation on x {
                    running: win.noir && win.visible && noirRoute.implicitWidth > noirRouteBox.width
                    loops: Animation.Infinite
                    PauseAnimation { duration: 1800 }
                    NumberAnimation { from: 0; to: Math.min(0, noirRouteBox.width - noirRoute.width); duration: Math.max(3500, Math.round((noirRoute.width - noirRouteBox.width) * 25)) }
                    PauseAnimation { duration: 1800 }
                    NumberAnimation { to: 0; duration: 900 }
                }
            }
        }
        Text { x: 715; y: 8; width: 305; height: 52; text: win.airline; color: win.foregroundColor; font.family: "sans-serif"; font.pixelSize: 26; wrapMode: Text.WordWrap; maximumLineCount: 2; fontSizeMode: Text.Fit; minimumPixelSize: 16; elide: Text.ElideRight; verticalAlignment: Text.AlignVCenter }
        Text { x: 1040; y: 8; width: 265; height: 52; text: win.aircraft; color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 24; fontSizeMode: Text.Fit; minimumPixelSize: 16; elide: Text.ElideRight; verticalAlignment: Text.AlignVCenter }
        Text { x: 1325; y: 8; width: 565; height: 52; text: win.routeNote; color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 22; wrapMode: Text.WordWrap; maximumLineCount: 2; fontSizeMode: Text.Fit; minimumPixelSize: 16; elide: Text.ElideRight; verticalAlignment: Text.AlignVCenter }
        Text { x: 28; y: 68; width: 182; height: 52; text: win.distance + win.tr(" DIST", " DIST"); color: win.foregroundColor; font.family: "sans-serif"; font.pixelSize: 25; fontSizeMode: Text.Fit; minimumPixelSize: 17; elide: Text.ElideRight; verticalAlignment: Text.AlignVCenter }
        Text { x: 230; y: 68; width: 240; height: 52; text: win.altitude + win.tr(" ALT. BAR.", " BAR. ALT."); color: win.foregroundColor; font.family: "sans-serif"; font.pixelSize: 24; fontSizeMode: Text.Fit; minimumPixelSize: 16; elide: Text.ElideRight; verticalAlignment: Text.AlignVCenter }
        Text { x: 490; y: 68; width: 190; height: 52; text: win.view ? win.formatDistance(win.view.spanKm) + win.tr(" MAPA", " MAP") : ""; color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 22; fontSizeMode: Text.Fit; minimumPixelSize: 16; elide: Text.ElideRight; verticalAlignment: Text.AlignVCenter }
        Text { x: 700; y: 68; width: 345; height: 52; text: win.signal; color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 22; wrapMode: Text.WordWrap; maximumLineCount: 2; fontSizeMode: Text.Fit; minimumPixelSize: 16; elide: Text.ElideRight; verticalAlignment: Text.AlignVCenter }
        Text { x: 1065; y: 68; width: 330; height: 52; text: win.dataAge; color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 22; wrapMode: Text.WordWrap; maximumLineCount: 2; fontSizeMode: Text.Fit; minimumPixelSize: 16; elide: Text.ElideRight; verticalAlignment: Text.AlignVCenter }
        Text { x: 1415; y: 68; width: 475; height: 52; text: win.tr("Posição estimada entre observações", "Position estimated between observations"); color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 22; wrapMode: Text.WordWrap; maximumLineCount: 2; fontSizeMode: Text.Fit; minimumPixelSize: 16; elide: Text.ElideRight; verticalAlignment: Text.AlignVCenter }
        Text { x: 28; y: 132; width: 1182; height: 30; text: "© OpenStreetMap contributors · © OpenMapTiles · OpenFreeMap · ADSB.fi · ADSB.lol · ADSBdb"; color: "#aeb8c0"; font.family: "sans-serif"; font.pixelSize: 19; fontSizeMode: Text.Fit; minimumPixelSize: 15; elide: Text.ElideRight }
        Text { x: 1225; y: 132; width: 665; height: 30; text: win.altitudeNote; color: "#c5cdd3"; horizontalAlignment: Text.AlignRight; font.family: "sans-serif"; font.pixelSize: 19; fontSizeMode: Text.Fit; minimumPixelSize: 15; elide: Text.ElideRight }
    }
    // Keep the map scale outside the circular clip, where it remains legible.
    Text { visible: win.theme === "lavender"; x: 915; y: 174; width: 175; text: win.view ? win.formatDistance(win.view.spanKm).toUpperCase() + win.tr(" DE MAPA", " MAP WIDTH") : ""; color: win.foregroundColor; font.family: monoFont.name; font.pixelSize: 20; horizontalAlignment: Text.AlignRight }
    // The lavender theme frames the real live map in a circle. The map's own
    // geometry, camera and markers remain unchanged behind the mask.
    ShaderEffect {
        visible: win.theme === "lavender"
        x: map.x; y: map.y; width: map.width; height: map.height
        property variant source: ShaderEffectSource {
            sourceItem: win.theme === "lavender" ? map : null
            hideSource: true
            live: true
        }
        fragmentShader: "varying highp vec2 qt_TexCoord0; uniform sampler2D source; uniform lowp float qt_Opacity; void main() { highp vec2 p = qt_TexCoord0 - vec2(0.5); lowp float mask = step(dot(p, p), 0.25); gl_FragColor = texture2D(source, qt_TexCoord0) * mask * qt_Opacity; }"
    }
    Rectangle { visible: !win.modern && !win.eva && !win.noir; x: 1370; y: 110; width: 6; height: 940; color: win.accentColor }
    Item {
        visible: !win.modern && !win.eva && !win.noir
        x: 1410; y: 0; width: 470; height: 1080
        Text { y: 132; height: 150; text: win.code; color: win.accentColor; font.family: boldFont.name; font.pixelSize: 152; width:470; fontSizeMode: Text.Fit; minimumPixelSize:55 }
        Rectangle { y: 302; width: 470; height: 1; color: win.eva ? win.accentColor : "#60757e" }
        Text { y: 324; height: 98; text: win.route.toUpperCase(); color: "#f3efe7"; font.family:boldFont.name; font.pixelSize:66; width:470; wrapMode:Text.WordWrap; fontSizeMode:Text.Fit; minimumPixelSize:32; maximumLineCount:2; elide:Text.ElideRight; verticalAlignment:Text.AlignVCenter }
        Rectangle { y: 426; width: 470; height: 1; color: win.eva ? win.accentColor : "#60757e" }
        Text { y: 452; height: 46; text: win.routeNote; color:"#a1b5c0"; font.family:monoFont.name; font.pixelSize:20; width:470; wrapMode:Text.WordWrap; maximumLineCount:2; elide:Text.ElideRight }
        Text { y: 500; height: 70; text: win.airline.toUpperCase(); color: "#f3efe7"; font.family:boldFont.name; font.pixelSize:52; width:470; fontSizeMode:Text.Fit; minimumPixelSize:30; wrapMode:Text.WordWrap; maximumLineCount:2; elide:Text.ElideRight }
        Text { y: 578; height: 50; text: win.aircraft.toUpperCase(); color: "#f3efe7"; font.family:boldFont.name; font.pixelSize:48; width:470; fontSizeMode:Text.Fit; minimumPixelSize:28; elide:Text.ElideRight }
        Rectangle { y: 650; width: 470; height: 1; color: win.eva ? win.accentColor : "#60757e" }
        Text { y: 678; text: win.tr("DISTÂNCIA", "DISTANCE"); color:win.eva ? "#f3efe7" : "#94cea6"; font.family:displayFont.name; font.pixelSize:28; font.letterSpacing:2 }
        Text { y: 710; height: 100; width:470; text: win.distance; color:win.accentColor; font.family:boldFont.name; font.pixelSize:92; fontSizeMode:Text.Fit; minimumPixelSize:50 }
        Text { y: 818; text: win.tr("ALTITUDE BAROMÉTRICA", "BAROMETRIC ALTITUDE"); color:win.eva ? "#f3efe7" : "#94cea6"; font.family:displayFont.name; font.pixelSize:28; font.letterSpacing:2 }
        Text { y: 850; height: 100; width:470; text: win.altitude; color:win.accentColor; font.family:boldFont.name; font.pixelSize:92; fontSizeMode:Text.Fit; minimumPixelSize:50 }
        Rectangle { y: 952; width: 470; height: 1; color: win.eva ? win.accentColor : "#60757e" }
        Text { y: 950; width:470; height:20; text:win.altitudeNote; color:"#a1b5c0"; font.family:monoFont.name; font.pixelSize:16; elide:Text.ElideRight }
        Text { y: 970; width:470; height:48; text: win.signal; color:"#a1b5c0"; font.family:monoFont.name; font.pixelSize:18; wrapMode:Text.WordWrap; maximumLineCount:2; elide:Text.ElideRight }
        Text { y: 1010; width:470; text: win.dataAge; color:"#a1b5c0"; font.family:monoFont.name; font.pixelSize:17 }
        Text { y: 1040; width:470; height:30; text: win.tr("Posição estimada entre observações", "Position estimated between observations"); color:"#a1b5c0"; font.family:monoFont.name; font.pixelSize:17; wrapMode:Text.WordWrap }
    }
    Rectangle { visible: win.eva; x: map.x; y: map.y; width: map.width; height: map.height; color: "transparent"; border.color: win.accentColor; border.width: 2 }
    Item {
        visible: win.eva; x: 12; y: 193; width: 75; height: 800
        Rectangle { x: 0; y: 0; width: 75; height: 800; color: "#050505"; border.color: win.accentColor; border.width: 1 }
        Image { x: 4; y: 4; width: 67; height: 100; source: "airplane-assets/warning-stripes.png"; fillMode: Image.PreserveAspectCrop; clip: true; smooth: true }
        Text { x: 6; y: 135; text: "01"; color: "#ab49c9"; font.family: boldFont.name; font.pixelSize: 48 }
        Text { x: 6; y: 196; text: win.tr("MAPA", "MAP"); color: "#ab49c9"; font.family: boldFont.name; font.pixelSize: 18 }
        Rectangle { x: 0; y: 298; width: 75; height: 1; color: win.accentColor }
        Text { x: 6; y: 315; text: "02"; color: "#ab49c9"; font.family: boldFont.name; font.pixelSize: 48 }
        Text { x: 6; y: 375; text: win.tr("ZONA", "AREA"); color: "#ab49c9"; font.family: boldFont.name; font.pixelSize: 18 }
        Rectangle { x: 0; y: 495; width: 75; height: 1; color: win.accentColor }
        Text { x: 6; y: 513; text: "03"; color: "#ab49c9"; font.family: boldFont.name; font.pixelSize: 48 }
        Text { x: 6; y: 574; text: win.tr("VOO", "FLIGHT"); color: "#ab49c9"; font.family: boldFont.name; font.pixelSize: 18 }
    }
    Text { visible: !win.modern && !win.eva && !win.noir; x:40; y:1018; text:"© OpenStreetMap contributors · © OpenMapTiles · OpenFreeMap"; color:"#a1b5c0"; font.family:monoFont.name; font.pixelSize:16 }
    Text { visible: !win.modern && !win.eva && !win.noir; x:40; y:1040; text:"adsb.fi · https://adsb.fi · ADSB.lol · ADSBdb"; color:"#a1b5c0"; font.family:monoFont.name; font.pixelSize:16 }
    // Large, theme-specific type keeps the live card faithful to each composition.
    Item {
        id: modernDetails
        visible: win.modern
        x: win.theme === "coast" ? 70 : win.theme === "lavender" ? 1210 : 1350
        y: win.theme === "coast" ? 180 : win.theme === "lavender" ? 220 : 260
        width: win.theme === "coast" ? 635 : win.theme === "lavender" ? 650 : 520
        height: 730
        Rectangle { visible: win.theme === "lavender"; x: 0; y: 0; width: Math.min(parent.width, phaseModern.implicitWidth + 68); height: 64; radius: 32; color: "#ffb6b1" }
        Text { id: phaseModern; visible: win.theme !== "sage"; x: win.theme === "lavender" ? 32 : 0; y: win.theme === "lavender" ? 12 : 0; text: win.phase; color: win.theme === "lavender" ? win.foregroundColor : win.accentColor; font.family: "sans-serif"; font.bold: true; font.pixelSize: 30; width: parent.width - 32; elide: Text.ElideRight }
        Text { y: win.theme === "sage" ? 0 : 75; width: parent.width; height: 165; text: win.code; color: win.theme === "sage" ? win.accentColor : win.foregroundColor; font.family: "sans-serif"; font.bold: true; font.pixelSize: 155; fontSizeMode: Text.Fit; minimumPixelSize: 58; elide: Text.ElideRight }
        Text { y: win.theme === "sage" ? 187 : 245; width: parent.width; height: 90; text: win.route; color: win.foregroundColor; font.family: "sans-serif"; font.pixelSize: 56; fontSizeMode: Text.Fit; minimumPixelSize: 30; maximumLineCount: 2; wrapMode: Text.WordWrap; elide: Text.ElideRight }
        Rectangle { x: 0; y: win.theme === "sage" ? 288 : 348; width: parent.width; height: 1; color: win.secondaryColor; opacity: .35 }
        Text { y: win.theme === "sage" ? 310 : 365; width: parent.width; height: 55; text: win.airline; color: win.foregroundColor; font.family: "sans-serif"; font.bold: win.theme !== "coast"; font.pixelSize: 39; fontSizeMode: Text.Fit; minimumPixelSize: 26; maximumLineCount: 2; wrapMode: Text.WordWrap; elide: Text.ElideRight }
        Text { y: win.theme === "sage" ? 372 : 427; width: parent.width; text: win.aircraft; color: win.foregroundColor; font.family: "sans-serif"; font.pixelSize: 34; elide: Text.ElideRight }
        Item {
            visible: win.theme !== "sage"
            y: 520; width: parent.width; height: 170
            Rectangle { x: parent.width / 2; y: 0; width: 1; height: 145; color: win.secondaryColor; opacity: win.theme === "lavender" ? .4 : 0 }
            Text { x: 0; y: 0; width: parent.width * .48; text: win.tr("DISTÂNCIA", "DISTANCE"); color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 25; elide: Text.ElideRight }
            Text { x: 0; y: 38; width: parent.width * .48; height: 105; text: win.distance; color: win.accentColor; font.family: "sans-serif"; font.bold: true; font.pixelSize: 92; fontSizeMode: Text.Fit; minimumPixelSize: 42 }
            Text { x: parent.width * .52; y: 0; width: parent.width * .48; text: win.tr("ALTITUDE BAROMÉTRICA", "BAROMETRIC ALTITUDE"); color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 22; elide: Text.ElideRight }
            Text { x: parent.width * .52; y: 38; width: parent.width * .48; height: 105; text: win.altitude; color: win.accentColor; font.family: "sans-serif"; font.bold: true; font.pixelSize: 92; fontSizeMode: Text.Fit; minimumPixelSize: 42 }
            Text { x: parent.width * .52; y: 144; width: parent.width * .48; text: win.altitudeNote; color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 17; elide: Text.ElideRight }
        }
    }
    Item {
        visible: win.theme === "sage"; x: 70; y: 870; width: 1780; height: 145
        Rectangle { x: 0; y: 0; width: 1780; height: 2; color: win.secondaryColor; opacity: .35 }
        Text { x: 0; y: 18; text: win.tr("DISTÂNCIA", "DISTANCE"); color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 24 }
        Text { x: 180; y: 5; width: 590; height: 120; text: win.distance; color: win.accentColor; font.family: boldFont.name; font.pixelSize: 120; fontSizeMode: Text.Fit; minimumPixelSize: 45 }
        Rectangle { x: 780; y: 18; width: 1; height: 100; color: win.secondaryColor; opacity: .4 }
        Text { x: 820; y: 18; text: win.tr("ALTITUDE BAROMÉTRICA", "BAROMETRIC ALTITUDE"); color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 24 }
        Text { x: 1110; y: 5; width: 610; height: 120; text: win.altitude; color: win.accentColor; font.family: boldFont.name; font.pixelSize: 120; fontSizeMode: Text.Fit; minimumPixelSize: 45 }
        Text { x: 1120; y: 123; width: 590; text: win.altitudeNote; color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 17; elide: Text.ElideRight }
    }
    // Source and freshness information is real data, even in the decorative themes.
    Item {
        visible: win.modern && win.theme !== "coast"; x: 70; y: 1015; width: 1780; height: 60
        Text { x: 0; y: 0; width: 910; text: win.routeNote + "  ·  " + win.signal; color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 17; elide: Text.ElideRight }
        Text { x: 0; y: 26; width: 910; text: win.dataAge + "  ·  " + win.tr("Posição estimada entre observações", "Position estimated between observations"); color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 17; elide: Text.ElideRight }
        Text { x: 930; y: 0; width: 850; text: "© OpenStreetMap contributors · © OpenMapTiles · OpenFreeMap · ADSB.fi · ADSB.lol · ADSBdb"; color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 16; elide: Text.ElideRight }
    }
    Item {
        visible: win.theme === "coast"; x: 70; y: 905; width: 620; height: 170
        Text { y: 0; width: parent.width; text: win.routeNote; color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 17; elide: Text.ElideRight }
        Text { y: 23; width: parent.width; text: win.signal; color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 17; elide: Text.ElideRight }
        Text { y: 46; width: parent.width; text: win.dataAge; color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 17; elide: Text.ElideRight }
        Text { y: 69; width: parent.width; text: win.tr("Posição estimada entre observações", "Position estimated between observations"); color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 17; elide: Text.ElideRight }
        Text { y: 104; width: parent.width; text: "© OpenStreetMap contributors · © OpenMapTiles · OpenFreeMap"; color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 16; elide: Text.ElideRight }
        Text { y: 126; width: parent.width; text: "ADSB.fi · ADSB.lol · ADSBdb"; color: win.secondaryColor; font.family: "sans-serif"; font.pixelSize: 16; elide: Text.ElideRight }
    }
    // The command-screen theme is a distinct composition, not a recoloured classic card.
    Item {
        visible: win.eva; x: 1400; y: 193; width: 500; height: 800
        Rectangle { anchors.fill: parent; color: "#050505"; border.color: win.accentColor; border.width: 2 }
        Text { x: 18; y: 8; text: win.tr("VOO", "FLIGHT"); color: "#f3efe7"; font.family: monoFont.name; font.pixelSize: 20 }
        Text { x: 16; y: 34; width: 465; height: 124; text: win.code; color: win.accentColor; font.family: boldFont.name; font.pixelSize: 142; fontSizeMode: Text.Fit; minimumPixelSize: 55; elide: Text.ElideRight }
        Rectangle { x: 14; y: 165; width: 470; height: 1; color: win.accentColor }
        Text { x: 18; y: 172; text: win.tr("ORIGEM → DESTINO", "ORIGIN → DESTINATION"); color: "#d3ceca"; font.family: monoFont.name; font.pixelSize: 18 }
        Text { x: 18; y: 198; width: 455; height: 65; text: win.route.toUpperCase(); color: "#f3efe7"; font.family: boldFont.name; font.pixelSize: 58; fontSizeMode: Text.Fit; minimumPixelSize: 28; elide: Text.ElideRight }
        Rectangle { x: 14; y: 270; width: 470; height: 1; color: win.accentColor }
        Text { x: 18; y: 277; width: 460; height: 34; text: win.routeNote; color: "#c6c1bb"; font.family: monoFont.name; font.pixelSize: 19; elide: Text.ElideRight }
        Rectangle { x: 14; y: 315; width: 470; height: 1; color: win.accentColor }
        Text { x: 18; y: 321; text: win.tr("COMPANHIA AÉREA", "AIRLINE"); color: "#c6c1bb"; font.family: monoFont.name; font.pixelSize: 18 }
        Text { x: 18; y: 347; width: 455; height: 52; text: win.airline.toUpperCase(); color: "#f3efe7"; font.family: boldFont.name; font.pixelSize: 48; fontSizeMode: Text.Fit; minimumPixelSize: 27; elide: Text.ElideRight }
        Rectangle { x: 14; y: 404; width: 470; height: 1; color: win.accentColor }
        Text { x: 18; y: 410; text: win.tr("AERONAVE", "AIRCRAFT"); color: "#c6c1bb"; font.family: monoFont.name; font.pixelSize: 18 }
        Text { x: 18; y: 437; width: 455; height: 52; text: win.aircraft.toUpperCase(); color: "#f3efe7"; font.family: boldFont.name; font.pixelSize: 48; fontSizeMode: Text.Fit; minimumPixelSize: 25; elide: Text.ElideRight }
        Rectangle { x: 14; y: 494; width: 470; height: 1; color: win.accentColor }
        Text { x: 18; y: 501; text: win.tr("DISTÂNCIA", "DISTANCE"); color: "#f3efe7"; font.family: monoFont.name; font.pixelSize: 20 }
        Text { x: 16; y: 530; width: 450; height: 88; text: win.distance; color: win.accentColor; font.family: boldFont.name; font.pixelSize: 98; fontSizeMode: Text.Fit; minimumPixelSize: 50 }
        Text { x: 18; y: 627; text: win.tr("ALTITUDE BAROMÉTRICA", "BAROMETRIC ALTITUDE"); color: "#f3efe7"; font.family: monoFont.name; font.pixelSize: 20 }
        Text { x: 16; y: 654; width: 450; height: 88; text: win.altitude; color: win.accentColor; font.family: boldFont.name; font.pixelSize: 98; fontSizeMode: Text.Fit; minimumPixelSize: 50 }
        Text { x: 18; y: 747; width: 460; text: win.altitudeNote; color: "#c6c1bb"; font.family: monoFont.name; font.pixelSize: 16; elide: Text.ElideRight }
        Repeater { model: 5; Rectangle { x: 0; y: 14 + index * 148; width: 7; height: 100; color: win.accentColor } }
    }
    Item {
        visible: win.eva; x: 100; y: 1000; width: 1800; height: 70
        Text { x: 0; y: 8; width: 1230; text: "© OpenStreetMap contributors · © OpenMapTiles · OpenFreeMap · ADSB.fi · ADSB.lol · ADSBdb"; color: "#ddd8d1"; font.family: monoFont.name; font.pixelSize: 17; elide: Text.ElideRight }
        Text { x: 1300; y: 0; width: 500; text: win.signal + " · " + win.dataAge; color: "#ddd8d1"; font.family: monoFont.name; font.pixelSize: 16; elide: Text.ElideRight }
        Text { x: 1300; y: 29; width: 500; text: win.tr("Posição estimada entre observações", "Position estimated between observations"); color: "#ddd8d1"; font.family: monoFont.name; font.pixelSize: 16; elide: Text.ElideRight }
    }
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
