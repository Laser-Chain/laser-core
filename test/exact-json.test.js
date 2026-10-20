const assert=require('node:assert/strict');
const test=require('node:test');
const {parseExactJSON}=require('../exact-json');
test('native JSON retains uint64 values, escaped text, signed integers and decimals',()=>{
  const data=parseExactJSON('{"balance_photons":18446744073709551615,"small":3,"negative":-9007199254740993,"text":"123\\\"456","ratio":1.5}');
  assert.equal(data.balance_photons,'18446744073709551615');assert.equal(data.negative,'-9007199254740993');assert.equal(data.small,3);assert.equal(data.ratio,1.5);assert.equal(data.text,'123"456');
});
