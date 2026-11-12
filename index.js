"use strict";

/*
  wmic calls must always be serialised in windows, hence the use of async.queue
*/
var MAX_WORKER_COUNT = 100;
var execFile = require('child_process').execFile,
    async = require('async'),
    fs = require('fs'),
    path = require('path'),
    iconv = require('iconv-lite');

/**
 * Need to split a command line string taking into account strings - that is, don't
 * split spaces within a string. So that 'P1 P2 "Other Param" P4' is split into 4 param strings
 * with param 3 = "Other Param" (not including quotes).
 **/
function splitter(cmd) {
  cmd = cmd.trim();

  var acc = [], inString = false, cur = "", l = cmd.length;

  for (var i = 0 ; i < l ; i++ ){
    var ch = cmd.charAt(i);
    switch(ch) {
    case '"':
      inString = !inString;
      if (!inString) {
        if (cur.length > 0) {
          acc.push(cur);
          cur = "";
        }
      }
      break;
    case ' ':
      if (inString) {
        cur += ' ';
      } else {
        if (cur.length > 0) {
          acc.push(cur);
          cur = "";
        }
      }
      break;
    default:
      cur += ch;
      break;
    }
  }

  if (cur.length > 0) acc.push(cur);
  return acc;
};


function parse_list(data){

  var list = [];

  var blocks = data.split(/\n\n|\n,?\r/g).filter(function(block) {
    return block.length > 2;
  });

  blocks.forEach(function(block) {
    var obj   = {};
    var lines = block.split(/\n+|\r+/).filter(function(line) {
      return line.indexOf('=') !== -1
    });

    lines.forEach(function(line) {
      // WMIC-style list output is key=value. Values may also include '=' so split once.
      var cleaned = line.replace(/^,/, '');
      var sep = cleaned.indexOf('=');
      if (sep === -1) return;

      var key = cleaned.slice(0, sep);
      var value = cleaned.slice(sep + 1);
      obj[key] = value;
    })

    if (Object.keys(obj).length > 0)
      list.push(obj);
  })

  return list;
}

function parse_values(out){

  var arr  = [],
      data = buildDataArray(out),
      keys = data[0];

  if (!keys) return arr;

  data.forEach(function(k, i){
    if(k != keys){
      var obj = {};

      k.forEach(function(l, j){
        obj[keys[j]] = l
      })

      arr.push(obj);
    }
  });

  return arr;
}

function buildDataArray(rawInput){
  var lines = rawInput.toString().trim().split('\n'),
      data = [],
      keys = [],
      linePattern = /(\S*?\s\s+)/g,
      match;

  if (!lines.length || !lines[0]) return [];

  if (lines[0].indexOf('\t') !== -1) {
    lines.forEach(function(line) {
      data.push(line.split('\t').map(function(value) {
        return value.trim();
      }));
    });
    return data;
  }

  while ((match = linePattern.exec(lines[0])) !== null) {
    if (match.index === linePattern.lastIndex) {
        linePattern.lastIndex++;
    }

    var key = {};

    key.string = match[0].trim();
    key.startPoint = lines[0].indexOf(key.string);
    key.keyLength = match[0].length;

    keys.push(key);
  }

  lines.forEach(function(line, index){
    var lineData = [];

    keys.forEach(function(key, jndex){
      lineData.push(line.substr(key.startPoint, key.keyLength).trim());
    })

    data.push(lineData);
  })

  return data;
}

function get_encoding(stdout) {
    var codePage = stdout.replace(/\n.*$/s, '').replace(/\D/g, '');
    return codePage;
}

exports.get_encoding = get_encoding;

/**
 * Run the wmic command provided.
 *
 * The resulting output string has an additional pid property added so, one may get the process
 * details. This seems the easiest way of doing so given the run is in a queue.
 **/
var run = exports.run = function run(cmd, cb) {
  queue.push(cmd, cb);
};

var SHELLS = ['pwsh', 'powershell'];
var ALIASES = {
  account: 'Win32_UserAccount',
  baseboard: 'Win32_BaseBoard',
  battery: 'Win32_Battery',
  bios: 'Win32_BIOS',
  bootconfig: 'Win32_BootConfiguration',
  cdrom: 'Win32_CDROMDrive',
  computer: 'Win32_ComputerSystem',
  computersystem: 'Win32_ComputerSystem',
  cpu: 'Win32_Processor',
  desktop: 'Win32_Desktop',
  disk: 'Win32_LogicalDisk',
  diskdrive: 'Win32_DiskDrive',
  filesystem: 'Win32_FileSystem',
  logicaldisk: 'Win32_LogicalDisk',
  memorychip: 'Win32_PhysicalMemory',
  motherboard: 'Win32_BaseBoard',
  nic: 'Win32_NetworkAdapter',
  nicconfig: 'Win32_NetworkAdapterConfiguration',
  networkadapter: 'Win32_NetworkAdapter',
  networkadapterconfiguration: 'Win32_NetworkAdapterConfiguration',
  os: 'Win32_OperatingSystem',
  partition: 'Win32_DiskPartition',
  pagefile: 'Win32_PageFile',
  physicalmemory: 'Win32_PhysicalMemory',
  printer: 'Win32_Printer',
  process: 'Win32_Process',
  processor: 'Win32_Processor',
  product: 'Win32_Product',
  service: 'Win32_Service',
  share: 'Win32_Share',
  sounddevice: 'Win32_SoundDevice',
  startup: 'Win32_StartupCommand',
  useraccount: 'Win32_UserAccount',
  videcontroller: 'Win32_VideoController',
  videocontroller: 'Win32_VideoController',
  volume: 'Win32_Volume'
};

function normalizeLegacyClassName(section) {
  var name = String(section || '').trim();
  if (!name) return '';

  name = name.replace(/^.+[:\\/]/, '');
  name = name.replace(/^win32_/i, '');
  name = name.replace(/[^a-z0-9]+/gi, ' ');
  name = name.replace(/\s+/g, ' ').trim();

  if (!name) return '';
  return 'Win32_' + name.split(' ').map(function(part) {
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }).join('_');
}

// Translate common WMIC aliases to CIM class names while still accepting explicit Win32_* names.
function resolveClassName(section) {
  if (!section) return '';
  if (/^win32_/i.test(section)) return section;

  var normalized = String(section).trim().toLowerCase();
  if (ALIASES[normalized]) return ALIASES[normalized];

  return normalizeLegacyClassName(section);
}

function parseCommandSpec(cmd) {
  var args = splitter(cmd);
  var section = args.shift();
  var condition = null;

  if (args[0] && args[0].toLowerCase() === 'where') {
    args.shift();
    condition = args.shift() || null;
    if (condition && /[\r\n]/.test(condition)) {
      throw new Error('Invalid condition');
    }
  }

  var action = (args.shift() || '').toLowerCase();
  if (!section || !action) throw new Error('Invalid command');

  if (action === 'list') {
    return {
      type: 'list',
      section: resolveClassName(section),
      condition: condition
    };
  }

  if (action !== 'get') {
    if (/^(?:all|full|brief|\*)$/.test(action)) {
      return {
        type: 'list',
        section: resolveClassName(section),
        condition: condition
      };
    }
    throw new Error('Unsupported command');
  }

  var valueMode = false;
  var rawFields = args.filter(function(arg) {
    var isValueSwitch = arg.toLowerCase() === '/value';
    valueMode = valueMode || isValueSwitch;
    return !isValueSwitch;
  }).join(' ').trim();

  if (!rawFields || /^\/?(?:all|full|brief|\*)$/i.test(rawFields)) {
    return {
      type: 'list',
      section: resolveClassName(section),
      condition: condition
    };
  }

  var fields = rawFields.split(/[\s,]+/).map(function(field) {
    return field.trim();
  }).filter(Boolean);

  if (!fields.length) {
    return {
      type: 'list',
      section: resolveClassName(section),
      condition: condition
    };
  }

  return {
    type: valueMode ? 'value' : 'table',
    section: resolveClassName(section),
    condition: condition,
    fields: fields
  };
}

function createNoShellError() {
  var err = new Error('Unable to find PowerShell command in path.');
  err.code = 'ENOENT';
  return err;
}

var POWER_SHELL_SCRIPT_PATH = path.join(__dirname, 'powershell', 'wmic-query.ps1');
var POWER_SHELL_SPEC_PLACEHOLDER = '__WMIC_SPEC_BASE64__';
var powerShellScriptTemplate;

// Read and cache script template once per process for lower per-call overhead.
function getPowerShellScriptTemplate() {
  if (!powerShellScriptTemplate) {
    powerShellScriptTemplate = fs.readFileSync(POWER_SHELL_SCRIPT_PATH, 'utf8');
  }
  return powerShellScriptTemplate;
}

function buildPowerShellScript(spec) {
  // Pass spec as encoded JSON to avoid fragile shell quoting and injection via interpolation.
  var encodedSpec = Buffer.from(JSON.stringify(spec), 'utf8').toString('base64');
  return getPowerShellScriptTemplate().split(POWER_SHELL_SPEC_PLACEHOLDER).join(encodedSpec);
}

function runPowerShell(spec, opts, cb) {
  var pid;
  // Build/encode once and reuse across fallback attempts (pwsh -> powershell).
  var script = buildPowerShellScript(spec);
  var encodedCommand = Buffer.from(script, 'utf16le').toString('base64');

  function attempt(index) {
    if (index >= SHELLS.length) {
      cb(createNoShellError(), '', pid);
      return;
    }

    var command = SHELLS[index];
    var ps = execFile(command, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand], opts);
    var stdout = [];
    var stderr = [];
    var done = false;

    pid = ps.pid;

    ps.on('error', function(err) {
      if (done) return;
      if (err.code === 'ENOENT') {
        done = true;
        attempt(index + 1);
        return;
      }

      done = true;
      cb(err, '', pid);
    });

    ps.stdout.on('data', function(d) { stdout.push(d); });
    ps.stderr.on('data', function(d) { stderr.push(d); });

    // Use "close" so all stdio streams are fully flushed before we parse output.
    ps.on('close', function(code) {
      if (done) return;
      done = true;
      var stdoutStr = stringifyBufferArray(stdout);
      var stderrStr = stringifyBufferArray(stderr);
      if (code !== 0) {
        cb(new Error(stderrStr || ('PowerShell command failed with exit code ' + code + '.')), stdoutStr, pid);
        return;
      }
      cb(null, stdoutStr, pid);
    });

    ps.stdin.end();
  }

  attempt(0);
}

var queue = async.queue(function(cmd, cb) {
  var opts = { env: process.env, cwd: process.env.TEMP };
  var spec;

  try {
    spec = parseCommandSpec(cmd);
  } catch (err) {
    cb(err, '');
    return;
  }

  runPowerShell(spec, opts, cb);
}, MAX_WORKER_COUNT);

function stringifyBufferArray(array) {
  return array.map(function(buffer) {
    return iconv.decode(buffer, 'utf8');
  }).join('');
}

exports.get_value = function(section, value, condition, cb){
  var cond = condition ? ' where "' + condition + '" ' : '';
  var cmd = section + cond + ' get ' + value + ' /value';

  run(cmd, function(err, out){
    if (err) return cb(err);

    var str = out.match(/=(.*)/);

    if (str)
      cb(null, str[1].trim());
    else
      cb(new Error("Wmic: Couldn't get " + value + " in " + section));
  })
}

exports.get_values = function(section, keys, condition, cb){

  var cond = condition ? ' where "' + condition + '" ' : '';
  var cmd = section + cond + ' get ' + keys;

  run(cmd, function(err, out){
    if (err) return cb(err);
    cb(null, parse_values(out));
  });

};


/**
 * Calls back an array of objects for the given command.
 *
 * This only works for alias commands with a LIST clause.
 **/
exports.get_list = function(cmd, callback) {
  run(cmd + ' list full', function(err, data) {
    if (err) return callback(err);
    callback(null, parse_list(data));
  });
};
