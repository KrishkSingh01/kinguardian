const assert = require("node:assert/strict");
const { getCountries, getCountryCallingCode, parsePhoneNumberWithError } = require("libphonenumber-js/max");
const test = require("node:test");

test("international phone metadata parses country-specific numbers to E.164", () => {
  const us = parsePhoneNumberWithError("+12133734253");
  const uk = parsePhoneNumberWithError("020 7031 3000", "GB");
  const india = parsePhoneNumberWithError("+919876543210");
  assert.equal(us.number, "+12133734253");
  assert.equal(us.country, "US");
  assert.equal(uk.number, "+442070313000");
  assert.equal(uk.country, "GB");
  assert.equal(india.country, "IN");
  assert.equal(us.isValid(), true);
  assert.equal(uk.isValid(), true);
  assert.equal(india.isValid(), true);
});

test("country selector metadata is global and does not assume one default country", () => {
  const countries = getCountries();
  assert.ok(countries.length > 200);
  assert.equal(getCountryCallingCode("US"), "1");
  assert.equal(getCountryCallingCode("GB"), "44");
  assert.equal(getCountryCallingCode("IN"), "91");
});
