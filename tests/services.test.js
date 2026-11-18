const test = require('node:test');
const assert = require('node:assert/strict');
const SymptomService = require('../src/services/SymptomService');
const MatchingService = require('../src/services/MatchingService');
const SpecialistService = require('../src/services/SpecialistService');
const NppesProviderRepository = require('../src/repositories/NppesProviderRepository');
const DistanceService = require('../src/DistanceService');
const ProviderController = require('../src/controllers/ProviderController');
const BookingLinkService = require('../src/services/BookingLinkService');

const symptoms = new SymptomService();
const address = {
  city: 'White Bear Lake',
  state: 'MN',
  zip: '55110'
};

function provider(id, overrides = {}) {
  return {
    id,
    npi: id,
    name: `Dr. Provider ${id}`,
    lastName: id,
    specialty: 'Dermatology',
    street: '3555 Willow Lake Boulevard',
    suite: '',
    city: 'Vadnais Heights',
    state: 'MN',
    zip: '55110',
    location: '3555 Willow Lake Boulevard, Vadnais Heights, MN',
    distanceMiles: 4.25,
    phone: '651-555-0100',
    ...overrides
  };
}

function createService(providers, distance = provider => provider.distanceMiles) {
  const queried = [];
  const repository = {
    searchBySpecialtyAndZip: async (specialty, state, zip) => {
      queried.push({ specialty, state, zip });
      return providers.filter(item => item.specialty === specialty);
    },
    findById: async id => providers.find(item => item.id === id) ?? null
  };
  const distanceService = {
    geocodeLocation: async () => ({ latitude: 44.95, longitude: -93.1 }),
    milesBetweenAddresses: async (_origin, destination) => distance(destination)
  };
  return {
    queried,
    service: new SpecialistService(
      repository,
      new BookingLinkService(),
      distanceService,
      []
    )
  };
}

test('symptom search includes the expanded supported symptoms', () => {
  assert.ok(symptoms.search('bloating').includes('Stomach Bloating'));
  assert.ok(symptoms.search('vision').includes('Vision Changes'));
  assert.ok(symptoms.search('ear').includes('Ear Pain'));
});

test('validates the one-to-three symptom selection limit', () => {
  assert.equal(symptoms.validateSymptoms([]).status, 'Missing');
  assert.equal(
    symptoms.validateSymptoms([
      'Acne',
      'Skin Rash',
      'Knee Pain',
      'Frequent Headaches'
    ]).valid,
    false
  );
});

test('urgent symptoms stop routine specialty matching', () => {
  const matching = new MatchingService(symptoms);
  assert.equal(matching.match(['Chest Pain']).status, 'Urgent');
  assert.deepEqual(matching.match(['Chest Pain']).specialties, []);
  assert.equal(matching.match(['Sudden Severe Headache']).status, 'Urgent');
});

test('routes supported symptoms to NPPES specialties and falls back to primary care', () => {
  const matching = new MatchingService(symptoms);
  assert.deepEqual(
    matching.match(['Abdominal Pain']).specialties,
    ['Gastroenterology']
  );
  assert.deepEqual(
    matching.match(['Ear Pain']).specialties,
    ['Otolaryngology']
  );
  assert.deepEqual(
    matching.match(['Blurred Vision']).specialties,
    ['Ophthalmology']
  );
  assert.deepEqual(
    matching.match(['Persistent Cough']).specialties,
    ['Primary Care']
  );
});

test('provider search includes nearby ZIP codes in the same state and sorts alphabetically', async () => {
  const matchingZip = provider('2222222222', { lastName: 'Jones' });
  const wrongZip = provider('1111111111', {
    lastName: 'Adams',
    zip: '55111'
  });
  const wrongState = provider('3333333333', {
    lastName: 'Brown',
    state: 'WI'
  });
  const { service, queried } = createService([
    matchingZip,
    wrongZip,
    wrongState
  ]);

  const results = await service.search({
    specialties: ['Dermatology'],
    address,
    maxDistance: 10
  });

  assert.deepEqual(results.map(item => item.id), [wrongZip.id, matchingZip.id]);
  assert.deepEqual(queried, [{
    specialty: 'Dermatology',
    state: 'MN',
    zip: '55110'
  }]);
  assert.equal(Object.hasOwn(results[0], 'npi'), false);
});

test('applies distance limit to unrounded mileage from the entered city and ZIP', async () => {
  const inside = provider('1111111111', {
    distanceMiles: 9.99
  });
  const outside = provider('2222222222', {
    street: '2 Main Street',
    distanceMiles: 10.001
  });
  const { service } = createService([inside, outside]);

  const results = await service.search({
    specialty: 'Dermatology',
    address,
    maxDistance: 10
  });
  assert.deepEqual(results.map(item => item.id), [inside.id]);
  assert.equal(results[0].distanceMiles, 9.99);
});

test('distance service geocodes city, state, and ZIP and validates state and ZIP', async () => {
  let requestUrl;
  let requestOptions;
  const distance = new DistanceService({
    fetchImpl: async (url, options) => {
      requestUrl = String(url);
      requestOptions = options;
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            address: 'White Bear Lake, Minnesota, 55110',
            location: { x: -93.0, y: 45.0 },
            attributes: {
                Match_addr: 'White Bear Lake, Minnesota, 55110',
              Region: 'Minnesota',
              Postal: '55110'
            }
          }]
        })
      };
    }
  });

  const point = await distance.geocodeLocation(address);
  assert.equal(requestOptions.method, 'POST');
  assert.equal(requestUrl.includes(address.zip), false);
  assert.equal(requestUrl.includes(address.city), false);
  assert.equal(
    new URLSearchParams(requestOptions.body).get('SingleLine'),
    'White Bear Lake, MN, 55110'
  );
  assert.equal(point.state, 'MN');
  assert.equal(point.zip, '55110');
});

test('distance service rejects a geocoder result with conflicting ZIP or state', async () => {
  const distance = new DistanceService({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          location: { x: -93, y: 45 },
          attributes: { Region: 'Wisconsin', Postal: '54701' }
        }]
      })
    })
  });

  await assert.rejects(
    distance.geocodeLocation(address),
    error => error.code === 'ADDRESS_MISMATCH'
  );
});

test('practice mileage uses ZIP centroid without requiring street-level geocoding', async () => {
  const distance = new DistanceService({
    fetchImpl: async () => { throw new Error('Street geocoding should not run'); }
  });
  const miles = await distance.milesBetweenAddresses(
    { latitude: 44.9, longitude: -93.1 },
    { street: '3555 Willow Lake Boulevard', city: 'Vadnais Heights', state: 'MN', zip: '55110' }
  );
  assert.ok(Number.isFinite(miles));
});

test('NPPES search requests nearby ZIP prefixes for radius filtering', async () => {
  const records = [
    {
      number: 1234567890,
      basic: { first_name: 'Avery', last_name: 'Adams', status: 'A' },
      addresses: [{
        address_purpose: 'LOCATION',
        address_1: '1 Main Street',
        city: 'White Bear Lake',
        state: 'MN',
        postal_code: '55110-0001'
      }],
      taxonomies: [{ primary: true, desc: 'Dermatology' }]
    },
    {
      number: 1234567891,
      basic: { first_name: 'Blair', last_name: 'Baker', status: 'A' },
      addresses: [{
        address_purpose: 'LOCATION',
        address_1: '2 Main Street',
        city: 'White Bear Lake',
        state: 'MN',
        postal_code: '55111'
      }],
      taxonomies: [{ primary: true, desc: 'Dermatology' }]
    }
  ];
  let searchUrl;
  const repository = new NppesProviderRepository({
    fetchImpl: async url => {
      searchUrl = new URL(url);
      return {
        ok: true,
        json: async () => ({ result_count: records.length, results: records })
      };
    }
  });

  const results = await repository.searchBySpecialtyAndZip(
    'Dermatology',
    'MN',
    '55110',
    ['55110', '55111']
  );
  assert.deepEqual(results.map(item => item.zip), ['55110', '55111']);
  assert.equal(searchUrl.searchParams.get('state'), 'MN');
  assert.equal(searchUrl.searchParams.get('postal_code'), '551*');
  assert.equal(searchUrl.searchParams.get('taxonomy_description'), 'Dermatology');
});

test('controller rejects a plan ID belonging to a different insurer', async () => {
  let called = false;
  const controller = new ProviderController({
    search: async () => {
      called = true;
      return [];
    }
  }, {
    insurers: [{
      id: 'alpha',
      name: 'Alpha',
      plans: [{ id: 'alpha-plan', name: 'Alpha Plan' }]
    }, {
      id: 'beta',
      name: 'Beta',
      plans: [{ id: 'beta-plan', name: 'Beta Plan' }]
    }]
  });
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };

  await controller.search({
    body: {
      city: 'White Bear Lake',
      state: 'MN',
      zip: '55110',
      maxDistance: 10,
      specialties: ['Dermatology'],
      insurerId: 'alpha',
      planId: 'beta-plan'
    }
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(called, false);
  assert.match(response.payload.error, /plan combination/i);
});

test('controller accepts city, state, and ZIP without persisting find filters', async () => {
  let captured;
  const controller = new ProviderController({
    search: async input => {
      captured = input;
      return [];
    }
  });
  const session = { intake: { zip: '55110' } };
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };

  await controller.search({
    body: {
      city: address.city,
      state: address.state,
      zip: address.zip,
      specialties: ['Dermatology']
    },
    session
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(captured.address, { city: address.city, state: address.state, zip: address.zip });
  assert.deepEqual(session, { intake: { zip: '55110' } });
  assert.equal(captured.address.street, undefined);
  assert.equal(JSON.stringify(response.payload).includes(address.zip), false);
});
