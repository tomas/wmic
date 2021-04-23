var wmic = require('../index');
var should = require('should');

describe('wmic', function() {
  describe('#values()', function() {
    it('should handle values with spaces in', function(done) {
      // This test assumes that your first network card has a space in its name, it should...

      wmic.get_values('nicconfig', 'description, ipaddress', null, function(err, values) {
        values[0].Description.indexOf(' ').should.not.equal(-1)
        done()
      })
    })

    it('should return multiple values', function(done) {
      // This test assumes you have more than one network card (you usually have some virtual ones)

      wmic.get_values('nicconfig', 'description, ipaddress', null, function(err, values) {
        values.length.should.not.equal(1)
        done()
      })
    })

    it('should set all the keys, not present ones to an empty sting', function(done) {
      // This test assumes that not every network card has an IP

      wmic.get_values('nicconfig', 'description, ipaddress', null, function(err, values) {
        values.forEach(function(value, index){
          value.Description.should.not.equal(undefined)
          value.IPAddress.should.not.equal(undefined)
        })
        done()
      })
    })

    it('should decode code page', function(done) {
        const test = (stdout, expected) => {
            var codePage = wmic.get_encoding(stdout);
            // console.log(`get_encoding: "${stdout.replace(/\r\n/g, '<cr><lf>')}" -> "${codePage}"`);
            codePage.should.equal(expected);
        }
        test('1234', '1234');
        test('Active code page: 850', '850');
        test("활占쏙옙 占쌘듸옙 占쏙옙占쏙옙占쏙옙: 949\r\n[0x7FFAF4317EA0] ANOMALY: meaningless REX prefix used", '949');
        test('Who knows which page is active right now', '');
        done();
    });

    it('should work', function(done) {
        wmic.get_value('os', 'OSLanguage', null, (err, value) => {
            should.not.exist(err);
            value.length.should.not.be.equal(0);
            done();
        });
    });

  })
})
