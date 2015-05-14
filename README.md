# WMIC

Node module to interact with the windows WMIC utility.

## Usage

### wmic.get_value(section, value, conditions, callback)

Returns a single value from wmic, for example to get the hostname:

```javascript
wmic.get_value('computersystem', 'name', null, function(err, value){
  console.log(value) // Your Hostname
})
```

### wmic.get_values(section, value, conditions, callback)

Returns an array of values from wmic, for example to list hard drives:

```javascript
wmic.get_values('logicaldisk', 'name, volumename', null, function(err, values){
  console.dir(values) // An array of disks
})
```
