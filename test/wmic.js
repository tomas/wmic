var should = require('should');
var EventEmitter = require('events').EventEmitter;
var childProcess = require('child_process');

function makeChild(execPlan) {
  var child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: function() {} };
  child.pid = 1234;

  process.nextTick(function() {
    if (execPlan.error) {
      child.emit('error', execPlan.error);
      return;
    }

    if (execPlan.stdout) {
      child.stdout.emit('data', Buffer.from(execPlan.stdout));
    }
    if (execPlan.stderr) {
      child.stderr.emit('data', Buffer.from(execPlan.stderr));
    }
    child.emit('close', execPlan.exitCode || 0);
  });

  return child;
}

function withWmic(execFileStub, runTest, done) {
  var originalExecFile = childProcess.execFile;
  childProcess.execFile = execFileStub;

  var wmic;
  try {
    delete require.cache[require.resolve('../index')];
    wmic = require('../index');
    runTest(wmic, function(err) {
      childProcess.execFile = originalExecFile;
      done(err);
    });
  } finally {
    if (childProcess.execFile !== originalExecFile && !wmic) {
      childProcess.execFile = originalExecFile;
    }
  }
}

describe('wmic', function() {
  describe('powershell runtime', function() {
    it('prefers pwsh when available', function(done) {
      var calls = [];
      withWmic(function(command, args) {
        calls.push({ command: command, args: args });
        return makeChild({ stdout: 'OSLanguage=1033\n\n' });
      }, function(wmic, finish) {
        wmic.get_value('os', 'OSLanguage', null, function(err, value) {
          try {
            should.not.exist(err);
            value.should.equal('1033');
            calls.length.should.equal(1);
            calls[0].command.should.equal('pwsh');
            calls[0].args[4].should.equal('-EncodedCommand');
            var script = Buffer.from(calls[0].args[5], 'base64').toString('utf16le');
            script.should.match(/Get-CimInstance/);
            var specBase64 = script.match(/FromBase64String\("([^"]+)"\)/)[1];
            var spec = JSON.parse(Buffer.from(specBase64, 'base64').toString('utf8'));
            spec.section.should.equal('Win32_OperatingSystem');
            script.should.not.match(/wmic/i);
            script.should.not.match(/cmd\.exe/i);
            finish();
          } catch (assertErr) {
            finish(assertErr);
          }
        });
      }, done);
    });

    it('falls back to powershell when pwsh is unavailable', function(done) {
      var calls = [];
      withWmic(function(command) {
        calls.push(command);
        if (command === 'pwsh') {
          var err = new Error('not found');
          err.code = 'ENOENT';
          return makeChild({ error: err });
        }
        return makeChild({ stdout: 'OSLanguage=1033\n\n' });
      }, function(wmic, finish) {
        wmic.get_value('os', 'OSLanguage', null, function(err, value) {
          try {
            should.not.exist(err);
            value.should.equal('1033');
            calls.should.eql(['pwsh', 'powershell']);
            finish();
          } catch (assertErr) {
            finish(assertErr);
          }
        });
      }, done);
    });

    it('does not invoke cmd.exe or wmic.exe', function(done) {
      var commands = [];
      withWmic(function(command) {
        commands.push(command);
        return makeChild({ stdout: 'Description  IPAddress  \nAdapter     10.0.0.1   \n' });
      }, function(wmic, finish) {
        wmic.get_values('nicconfig', 'description, ipaddress', null, function(err) {
          try {
            should.not.exist(err);
            commands.should.not.containEql('cmd.exe');
            commands.should.not.containEql('wmic');
            finish();
          } catch (assertErr) {
            finish(assertErr);
          }
        });
      }, done);
    });

    it('preserves output parsing behavior for get_values', function(done) {
      withWmic(function() {
        return makeChild({
          stdout: 'Description   IPAddress  \nAdapter  One  10.0.0.1  \nAdapter Two              \n'
        });
      }, function(wmic, finish) {
        wmic.get_values('nicconfig', 'description, ipaddress', null, function(err, values) {
          try {
            should.not.exist(err);
            values.length.should.equal(2);
            values[0].Description.should.equal('Adapter  One');
            values[0].IPAddress.should.equal('10.0.0.1');
            values[1].Description.should.equal('Adapter Two');
            values[1].IPAddress.should.equal('');
            finish();
          } catch (assertErr) {
            finish(assertErr);
          }
        });
      }, done);
    });

    it('accepts legacy all-field get commands without explicit field names', function(done) {
      var calls = [];
      withWmic(function(command, args) {
        calls.push({ command: command, args: args });
        return makeChild({ stdout: 'Name=Default\n\n' });
      }, function(wmic, finish) {
        wmic.run('os get /all', function(err, stdout) {
          try {
            should.not.exist(err);
            stdout.should.equal('Name=Default\n\n');
            calls.length.should.equal(1);
            calls[0].command.should.equal('pwsh');
            var script = Buffer.from(calls[0].args[5], 'base64').toString('utf16le');
            var specBase64 = script.match(/FromBase64String\("([^"]+)"\)/)[1];
            var spec = JSON.parse(Buffer.from(specBase64, 'base64').toString('utf8'));
            spec.type.should.equal('list');
            spec.section.should.equal('Win32_OperatingSystem');
            finish();
          } catch (assertErr) {
            finish(assertErr);
          }
        });
      }, done);
    });

    it('accepts full legacy list and value syntax variants', function(done) {
      var acceptable = [
        'os list full',
        'os list brief',
        'os where "Name=\'x\'" get Name',
        'os get Name /value'
      ];

      var index = 0;
      function next() {
        if (index >= acceptable.length) return done();
        var command = acceptable[index++];
        withWmic(function(commandName, args) {
          var script = Buffer.from(args[5], 'base64').toString('utf16le');
          var specBase64 = script.match(/FromBase64String\("([^"]+)"\)/)[1];
          var spec = JSON.parse(Buffer.from(specBase64, 'base64').toString('utf8'));
          spec.section.should.equal('Win32_OperatingSystem');
          return makeChild({ stdout: 'Name=Default\n\n' });
        }, function(wmic, finish) {
          wmic.run(command, function(err) {
            try {
              should.not.exist(err);
              finish();
            } catch (assertErr) {
              finish(assertErr);
            }
          });
        }, function(err) {
          if (err) return done(err);
          next();
        });
      }
      next();
    });

    it('resolves legacy alias names to their Win32 CIM classes', function(done) {
      var calls = [];
      withWmic(function(command, args) {
        calls.push({ command: command, args: args });
        return makeChild({ stdout: 'Name=Default\n\n' });
      }, function(wmic, finish) {
        wmic.get_value('bios', 'Name', null, function(err) {
          try {
            should.not.exist(err);
            calls.length.should.equal(1);
            var script = Buffer.from(calls[0].args[5], 'base64').toString('utf16le');
            var specBase64 = script.match(/FromBase64String\("([^"]+)"\)/)[1];
            var spec = JSON.parse(Buffer.from(specBase64, 'base64').toString('utf8'));
            spec.section.should.equal('Win32_BIOS');
            finish();
          } catch (assertErr) {
            finish(assertErr);
          }
        });
      }, done);
    });

    it('returns a missing-shell error when no powershell is available', function(done) {
      withWmic(function() {
        var err = new Error('not found');
        err.code = 'ENOENT';
        return makeChild({ error: err });
      }, function(wmic, finish) {
        wmic.get_value('os', 'OSLanguage', null, function(err) {
          try {
            should.exist(err);
            err.message.should.equal('Unable to find PowerShell command in path.');
            finish();
          } catch (assertErr) {
            finish(assertErr);
          }
        });
      }, done);
    });

    it('surfaces command failures through stderr', function(done) {
      withWmic(function() {
        return makeChild({ stderr: 'Boom failed', exitCode: 1 });
      }, function(wmic, finish) {
        wmic.get_value('os', 'OSLanguage', null, function(err) {
          try {
            should.exist(err);
            err.message.should.equal('Boom failed');
            finish();
          } catch (assertErr) {
            finish(assertErr);
          }
        });
      }, done);
    });

    it('does not fail on stderr output when command exits successfully', function(done) {
      withWmic(function() {
        return makeChild({ stdout: 'OSLanguage=1033\n\n', stderr: 'warning text' });
      }, function(wmic, finish) {
        wmic.get_value('os', 'OSLanguage', null, function(err, value) {
          try {
            should.not.exist(err);
            value.should.equal('1033');
            finish();
          } catch (assertErr) {
            finish(assertErr);
          }
        });
      }, done);
    });

    it('rejects conditions with newlines', function(done) {
      withWmic(function() {
        return makeChild({ stdout: '' });
      }, function(wmic, finish) {
        wmic.get_value('os', 'OSLanguage', "Name='x'\nOR 1=1", function(err) {
          try {
            should.exist(err);
            err.message.should.equal('Invalid condition');
            finish();
          } catch (assertErr) {
            finish(assertErr);
          }
        });
      }, done);
    });

    it('preserves output parsing behavior for get_list', function(done) {
      withWmic(function() {
        return makeChild({
          stdout: 'Name=Ethernet 1\nNetEnabled=True\n\nName=Loopback Adapter\nNetEnabled=\n\n'
        });
      }, function(wmic, finish) {
        wmic.get_list('nic', function(err, values) {
          try {
            should.not.exist(err);
            values.length.should.equal(2);
            values[0].Name.should.equal('Ethernet 1');
            values[0].NetEnabled.should.equal('True');
            values[1].Name.should.equal('Loopback Adapter');
            values[1].NetEnabled.should.equal('');
            finish();
          } catch (assertErr) {
            finish(assertErr);
          }
        });
      }, done);
    });

    it('preserves list values containing equals characters', function(done) {
      withWmic(function() {
        return makeChild({
          stdout: 'Name=Adapter 1\nPath=C:=\\Program=Files\\Adapter\n\n'
        });
      }, function(wmic, finish) {
        wmic.get_list('nic', function(err, values) {
          try {
            should.not.exist(err);
            values.length.should.equal(1);
            values[0].Path.should.equal('C:=\\Program=Files\\Adapter');
            finish();
          } catch (assertErr) {
            finish(assertErr);
          }
        });
      }, done);
    });
  });

  describe('helpers', function() {
    it('decodes code pages', function() {
      var wmic = require('../index');
      wmic.get_encoding('1234').should.equal('1234');
      wmic.get_encoding('Active code page: 850').should.equal('850');
      wmic.get_encoding("활占쏙옙 占쌘듸옙 占쏙옙占쏙옙占쏙옙: 949\r\n[0x7FFAF4317EA0] ANOMALY").should.equal('949');
      wmic.get_encoding('Who knows which page is active right now').should.equal('');
    });
  });
});
