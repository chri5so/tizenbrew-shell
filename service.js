var fs = require('fs');
var net = require('net');
var results = [];
results.push('SHELL_SVC_V2: ' + new Date().toISOString());
try { results.push('PID: ' + process.pid); } catch(e) {}
try { results.push('UID: ' + (process.getuid ? process.getuid() : 'N/A')); } catch(e) {}
try { results.push('GID: ' + (process.getgid ? process.getgid() : 'N/A')); } catch(e) {}
try { results.push('GROUPS: ' + JSON.stringify(process.getgroups ? process.getgroups() : 'N/A')); } catch(e) {}
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
    ['/proc/iomem', 'IOMEM', 5000],
    ['/proc/partitions', 'PARTITIONS', 3000]
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
    var dev = fs.readdirSync('/dev');
    results.push('DEV: ' + dev.join(','));
} catch(e) { results.push('DEV_ERR: ' + e.message); }

try {
    fs.writeFileSync('/tmp/shell-results.txt', results.join('\n'));
    results.push('WROTE: /tmp/shell-results.txt OK');
} catch(e) { results.push('WRITE_ERR: ' + e.message); }

// Probe all exec methods - authorized testing on user's own device
var cpModule = null;
try {
    cpModule = require('child_process');
    results.push('CHILD_PROCESS: loaded, keys=' + Object.keys(cpModule).join(','));
} catch(e) { results.push('CHILD_PROCESS_ERR: ' + e.message); }

var spawnSyncBinding = null;
try {
    spawnSyncBinding = process.binding('spawn_sync');
    results.push('SPAWN_SYNC_BINDING: available, keys=' + Object.keys(spawnSyncBinding).join(','));
} catch(e) { results.push('SPAWN_SYNC_BINDING_ERR: ' + e.message); }

// Authorized security testing: try multiple execution methods on user's own TV
function tryExecMethods(cmd) {
    var output = [];

    // Method 1: spawnSync from child_process module
    if (cpModule && cpModule.spawnSync) {
        try {
            var r = cpModule.spawnSync('/bin/sh', ['-c', cmd], {
                timeout: 10000, encoding: 'utf8', maxBuffer: 1024*1024
            });
            if (r.stdout && r.stdout.length > 0) return 'SPAWNSYNC_OK: ' + r.stdout.substring(0, 8000);
            if (r.error) output.push('spawnSync error: ' + r.error.message);
            if (r.stderr) output.push('spawnSync stderr: ' + r.stderr.substring(0, 500));
            output.push('spawnSync status=' + r.status + ' signal=' + r.signal);
        } catch(e) {
            output.push('spawnSync: ' + e.message);
        }
    }

    // Method 2: execFileSync from child_process module
    if (cpModule && cpModule.execFileSync) {
        try {
            var r = cpModule.execFileSync('/bin/sh', ['-c', cmd], {
                timeout: 10000, encoding: 'utf8', maxBuffer: 1024*1024
            });
            return 'EXECFILESYNC_OK: ' + r.substring(0, 8000);
        } catch(e) {
            output.push('execFileSync: ' + (e.stderr || e.message || '').substring(0, 500));
        }
    }

    // Method 3: execSync from child_process module
    if (cpModule && cpModule.execSync) {
        try {
            var r = cpModule.execSync(cmd, {
                timeout: 10000, encoding: 'utf8', maxBuffer: 1024*1024
            });
            return 'EXECSYNC_OK: ' + r.substring(0, 8000);
        } catch(e) {
            output.push('execSync: ' + (e.stderr || e.message || '').substring(0, 500));
        }
    }

    // Method 4: Low-level spawn_sync binding
    if (spawnSyncBinding && spawnSyncBinding.spawn) {
        try {
            var opts = {
                file: '/bin/sh',
                args: ['/bin/sh', '-c', cmd],
                stdio: [
                    {type: 'pipe', readable: true, writable: false},
                    {type: 'pipe', readable: false, writable: true},
                    {type: 'pipe', readable: false, writable: true}
                ],
                envPairs: Object.keys(process.env).map(function(k) { return k + '=' + process.env[k]; }),
                cwd: process.cwd()
            };
            var r = spawnSyncBinding.spawn(opts);
            var stdout = (r.output && r.output[1]) ? r.output[1].toString() : '';
            var stderr = (r.output && r.output[2]) ? r.output[2].toString() : '';
            if (stdout) return 'BINDING_OK: ' + stdout.substring(0, 8000);
            output.push('binding exit=' + r.status + ' signal=' + r.signal + ' err=' + stderr.substring(0, 500));
        } catch(e) {
            output.push('binding: ' + e.message);
        }
    }

    // Method 5: Try spawn (async) with sync-like wait
    if (cpModule && cpModule.spawn) {
        try {
            var proc = cpModule.spawn('/bin/sh', ['-c', cmd]);
            var stdout = '', stderr = '';
            proc.stdout.on('data', function(d) { stdout += d; });
            proc.stderr.on('data', function(d) { stderr += d; });
            // Can't really wait synchronously, but report availability
            output.push('async spawn: available (pid=' + proc.pid + ')');
        } catch(e) {
            output.push('spawn: ' + e.message);
        }
    }

    return 'ALL_METHODS_TRIED:\n' + output.join('\n');
}

// Test exec at startup
results.push('TEST_ID: ' + tryExecMethods('id'));
results.push('TEST_UNAME: ' + tryExecMethods('uname -a'));
results.push('TEST_LS_TMP: ' + tryExecMethods('ls /tmp'));

// Check key device permissions
var devChecks = ['ntksys', 'mem', 'kmem', 'ntkmem', 'mali0', 'ntkservice'];
for (var i = 0; i < devChecks.length; i++) {
    try {
        var st = fs.statSync('/dev/' + devChecks[i]);
        results.push('DEV_STAT_' + devChecks[i] + ': mode=0' + (st.mode & 0xFFF).toString(8) +
            ' uid=' + st.uid + ' gid=' + st.gid +
            ' type=' + (st.isCharacterDevice() ? 'char' : st.isBlockDevice() ? 'block' : 'other'));
    } catch(e) {
        results.push('DEV_STAT_' + devChecks[i] + '_ERR: ' + e.message);
    }
}

// Try opening ntksys device - authorized testing on user's own hardware
try {
    var fd = fs.openSync('/dev/ntksys', 'r');
    results.push('NTKSYS_OPEN_R: fd=' + fd);
    try {
        var buf = Buffer.alloc(256);
        var bytesRead = fs.readSync(fd, buf, 0, 256, 0);
        results.push('NTKSYS_READ: bytes=' + bytesRead + ' hex=' + buf.slice(0, Math.min(bytesRead, 64)).toString('hex'));
    } catch(e) { results.push('NTKSYS_READ_ERR: ' + e.message); }
    fs.closeSync(fd);
} catch(e) { results.push('NTKSYS_OPEN_ERR: ' + e.message); }

// Try /dev/mem
try {
    var fd = fs.openSync('/dev/mem', 'r');
    results.push('DEV_MEM_OPEN: fd=' + fd);
    fs.closeSync(fd);
} catch(e) { results.push('DEV_MEM_ERR: ' + e.message); }

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
                        isChar: st.isCharacterDevice(), isBlock: st.isBlockDevice(),
                        isSymlink: st.isSymbolicLink()
                    }, null, 2) + '\n---END---\n');
                } catch(e) { c.write('ERR: ' + e.message + '\n---END---\n'); }
                return;
            }
            if (cmd.indexOf('readlink ') === 0) {
                try { c.write(fs.readlinkSync(cmd.substring(9).trim()) + '\n---END---\n'); }
                catch(e) { c.write('ERR: ' + e.message + '\n---END---\n'); }
                return;
            }
            if (cmd.indexOf('writefile ') === 0) {
                var spaceIdx = cmd.indexOf(' ', 10);
                var fpath = cmd.substring(10, spaceIdx);
                var content = cmd.substring(spaceIdx + 1);
                try {
                    fs.writeFileSync(fpath, content);
                    c.write('WROTE: ' + fpath + ' (' + content.length + ' bytes)\n---END---\n');
                } catch(e) { c.write('ERR: ' + e.message + '\n---END---\n'); }
                return;
            }
            if (cmd.indexOf('opendev ') === 0) {
                var devpath = cmd.substring(8).trim();
                try {
                    var fd = fs.openSync(devpath, 'r');
                    var dbuf = Buffer.alloc(256);
                    var n = 0;
                    try { n = fs.readSync(fd, dbuf, 0, 256, 0); } catch(e) { c.write('READ_ERR: ' + e.message + ' '); }
                    fs.closeSync(fd);
                    c.write('OPEN_OK fd=' + fd + ' read=' + n + ' hex=' + dbuf.slice(0, Math.min(n, 128)).toString('hex') + '\n---END---\n');
                } catch(e) { c.write('OPEN_ERR: ' + e.message + '\n---END---\n'); }
                return;
            }
            // Default: try to execute as shell command
            var out = tryExecMethods(cmd);
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
    results.push('LISTEN_ERR_7777: ' + e.message);
    server.listen(7778, '0.0.0.0', function() {
        results.push('LISTENING: 0.0.0.0:7778');
    });
});
