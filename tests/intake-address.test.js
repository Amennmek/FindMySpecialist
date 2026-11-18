const test = require('node:test');
const assert = require('node:assert/strict');
const IntakeController = require('../src/controllers/IntakeController');
const SymptomService = require('../src/services/SymptomService');
test('intake accepts a valid non-Minnesota state/ZIP', () => {
  const controller = new IntakeController(new SymptomService());
  let code = 200, payload;
  const res = { status(value) { code = value; return this; }, json(value) { payload = value; return this; } };
  controller.submit({ body: { city: 'Chicago', state: 'IL', zip: '60601', age: 25, symptoms: ['Acne'] }, session: {} }, res);
  assert.equal(code, 200);
  assert.equal(payload.valid, true);
  assert.equal(payload.intake.state, 'IL');
});
