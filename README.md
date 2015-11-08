# wmic

Wrapper around the Windows WMIC interface for Node.js.

## Example

    var wmic = require('wmic');
    
    // equivalent of 'wmic nic get list'
    wmic.get_list('nic', function(err, nics) {
      // console.log(err || nics);
    })

## Credits

Written by Tomas Pollak.
    
## Small print

(c) Fork Ltd, MIT licensed.
