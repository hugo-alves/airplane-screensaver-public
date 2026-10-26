// ES5 / QtQuick Canvas. Keep feature bounds for close-zoom culling; share paths.
var NativeMap = (function () {
    var palette = {'#b8beb0':'#718e9c','#939f98':'#526f7e','#506263':'#2f4a59',
            '#5a6c70':'#45606e','#344247':'#243943','#07333e':'#153743',
            '#1a2a29':'#172a2c','#1b282b':'#192a30','#151e22':'#131f27'};
    function ink(color) {
        return palette[color] || color;
    }
    function prepare(shapes) {
        var fills = [], strokes = [], styles = {};
        for (var i = 0; i < shapes.length; i++) {
            var f = shapes[i];
            if (f.fill && f.polygon) fills.push(f);
            if (f.stroke) {
                var key = f.stroke + '/' + f.width, group = styles[key];
                if (!group) { group = {color:f.stroke, width:f.width, features:[]}; styles[key] = group; strokes.push(group); }
                group.features.push(f);
            }
        }
        // Thin local streets first, main roads above them.
        strokes.sort(function (a, b) { return a.width - b.width; });
        return {fills:fills, strokes:strokes};
    }
    function paint(ctx, data, frame, w, h) {
        var sx = w / frame.width, sy = h / frame.height, right = frame.x + frame.width, bottom = frame.y + frame.height;
        // Qt 5 Context2D accepts a complete SVG path. Let its native parser
        // and painter transform coordinates instead of crossing JS/C++ per vertex.
        var bulk = 'path' in ctx && typeof ctx.setTransform === 'function';
        var stats = {features:0, strokes:0, vertices:0, bulkPaths:bulk};
        function visible(f) {
            var b = f.bounds;
            return b[2] >= frame.x && b[0] <= right && b[3] >= frame.y && b[1] <= bottom;
        }
        function append(f) {
            stats.features++;
            for (var r = 0; r < f.paths.length; r++) {
                var ring = f.paths[r]; stats.vertices += ring.length;
                for (var n = 0; n < ring.length; n++) {
                    var px = (ring[n][0] - frame.x) * sx, py = (ring[n][1] - frame.y) * sy;
                    if (!n) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                }
                if (f.polygon) ctx.closePath();
            }
        }
        function nativePath(f) {
            stats.features++;
            if (f.nativePath === undefined) {
                var parts = [], count = 0;
                for (var r = 0; r < f.paths.length; r++) {
                    var ring = f.paths[r]; count += ring.length;
                    for (var n = 0; n < ring.length; n++) parts.push((n ? 'L' : 'M') + ring[n][0] + ' ' + ring[n][1]);
                    if (f.polygon && ring.length) parts.push('Z');
                }
                f.nativePath = parts.join(''); f.nativeVertices = count;
            }
            stats.vertices += f.nativeVertices;
            return f.nativePath;
        }
        if (bulk) ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#11191d'; ctx.fillRect(0, 0, w, h);
        if (bulk) ctx.setTransform(sx, 0, 0, sy, -frame.x * sx, -frame.y * sy);
        for (var i = 0; i < data.fills.length; i++) {
            var f = data.fills[i]; if (!visible(f)) continue;
            if (bulk) ctx.path = nativePath(f); else { ctx.beginPath(); append(f); }
            ctx.fillStyle = ink(f.fill); ctx.fill();
        }
        for (var g = 0; g < data.strokes.length; g++) {
            var group = data.strokes[g], count = 0, paths = [];
            if (!bulk) ctx.beginPath();
            for (i = 0; i < group.features.length; i++) {
                f = group.features[i]; if (!visible(f)) continue;
                if (bulk) paths.push(nativePath(f)); else append(f);
                count++;
            }
            if (count) {
                if (bulk) ctx.path = paths.join('');
                ctx.strokeStyle = ink(group.color); ctx.lineWidth = bulk ? group.width / sx : group.width;
                ctx.stroke(); stats.strokes++;
            }
        }
        if (bulk) ctx.setTransform(1, 0, 0, 1, 0, 0);
        return stats;
    }
    return {prepare:prepare, paint:paint};
}());
