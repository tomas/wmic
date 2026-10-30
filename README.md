# wmic

PowerShell-based wrapper around Windows WMI/CIM queries for Node.js.
It keeps the original `wmic` module API as a drop-in replacement while avoiding `wmic.exe`.

## Compatibility

- Public API is unchanged (`get_value`, `get_values`, `get_list`, `run`).
- Runtime shell selection order is:
  1. `pwsh`
  2. `powershell`
- The module no longer depends on `wmic.exe` or `cmd.exe` in the runtime path.

## Migration note

Existing consumers should not need code changes. This package preserves the original API contract and output shapes while internally using PowerShell/CIM instead of the deprecated `wmic.exe` execution path.

## Example

    var wmic = require('wmic');
    
    // API-compatible equivalent of querying NICs from legacy `wmic nic list full`
    wmic.get_list('nic', function(err, nics) {
      // console.log(err || nics);
    })

## Usage

### wmic.get_value(section, value, conditions, callback)

Returns a single value from wmic, for example to get the hostname:

    wmic.get_value('computersystem', 'name', null, function(err, value) {
      console.log(value) // Your Hostname
    })

### wmic.get_values(section, value, conditions, callback)

Returns an array of values from wmic, for example to list hard drives:

    wmic.get_values('logicaldisk', 'name, volumename', null, function(err, values) {
      console.dir(values) // An array of disks
    })

## Credits

Written by Tomas Pollak, with the help of contributors.
    
## Small print

(c) Fork Ltd, MIT licensed.
