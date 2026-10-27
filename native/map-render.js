// ES5 / QtQuick Canvas. Keep feature bounds for close-zoom culling; share paths.
var NativeMap = (function () {
    var palette = {'#b8beb0':'#718e9c','#939f98':'#526f7e','#506263':'#2f4a59',
            '#5a6c70':'#45606e','#344247':'#243943','#07333e':'#153743',
            '#1a2a29':'#172a2c','#1b282b':'#192a30','#151e22':'#131f27'};
    // Geometry retains its source classes; recolor at paint time so the same
    // downloaded map and camera work for every appearance.
    var themes = {
        noir: {background:'#10151c', colors:{'#b8beb0':'#62676a','#939f98':'#4a5054','#506263':'#30373b','#5a6c70':'#454b50','#344247':'#20262b','#07333e':'#0c131b','#1a2a29':'#0c1319','#1b282b':'#171d22','#151e22':'#1b2025'}},
        evangelion: {background:'#080d0d', colors:{'#b8beb0':'#d3d8cb','#939f98':'#9ba7a0','#506263':'#445350','#5a6c70':'#687370','#344247':'#273334','#07333e':'#001923','#1a2a29':'#102519','#1b282b':'#111e17','#151e22':'#080d0d'}},
        coast: {background:'#faf6ed', colors:{'#b8beb0':'#b8c6d5','#939f98':'#c5d2df','#506263':'#d9e1e5','#5a6c70':'#b7c7d4','#344247':'#d2dadb','#07333e':'#b9dded','#1a2a29':'#dbe9d7','#1b282b':'#f2f1e8','#151e22':'#faf6ed'}},
        lavender: {background:'#e5dff8', colors:{'#b8beb0':'#a7a1cb','#939f98':'#c3bde0','#506263':'#d6cfea','#5a6c70':'#b3acd5','#344247':'#d0c7e0','#07333e':'#a9c8f0','#1a2a29':'#cfdfd4','#1b282b':'#e8e5f3','#151e22':'#e5dff8'}},
        sage: {background:'#e4ecd9', colors:{'#b8beb0':'#a3b99f','#939f98':'#b1c5ab','#506263':'#c7d7bf','#5a6c70':'#a5bca2','#344247':'#bacbb1','#07333e':'#a9cbbd','#1a2a29':'#bdcfb1','#1b282b':'#dce8d4','#151e22':'#e4ecd9'}}
    };
    function ink(color, theme) {
        var selected = themes[theme];
        return selected ? (selected.colors[color] || color) : (palette[color] || color);
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
    function paint(ctx, data, frame, w, h, theme) {
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
        ctx.clearRect(0, 0, w, h); ctx.fillStyle = themes[theme] ? themes[theme].background : '#11191d'; ctx.fillRect(0, 0, w, h);
        if (bulk) ctx.setTransform(sx, 0, 0, sy, -frame.x * sx, -frame.y * sy);
        for (var i = 0; i < data.fills.length; i++) {
            var f = data.fills[i]; if (!visible(f)) continue;
            if (bulk) ctx.path = nativePath(f); else { ctx.beginPath(); append(f); }
            ctx.fillStyle = ink(f.fill, theme); ctx.fill();
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
                ctx.strokeStyle = ink(group.color, theme); ctx.lineWidth = bulk ? group.width / sx : group.width;
                ctx.stroke(); stats.strokes++;
            }
        }
        if (bulk) ctx.setTransform(1, 0, 0, 1, 0, 0);
        return stats;
    }
    return {prepare:prepare, paint:paint};
}());
