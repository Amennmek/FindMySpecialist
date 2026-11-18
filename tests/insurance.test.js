const test = require('node:test');
const assert = require('node:assert/strict');
const SpecialistService = require('../src/services/SpecialistService');
const BookingLinkService = require('../src/services/BookingLinkService');
const ProviderController = require('../src/controllers/ProviderController');

const catalog = {
  insurers: [
    {
      id: 'alpha',
      name: 'Alpha Health',
      plans: [
        {
          id: 'alpha-named',
          name: 'Alpha Gold Choice',
          sourceUrl: 'https://alpha.example/plans'
        },
        {
          id: 'alpha-other',
          name: 'Alpha Medicare Advantage',
          sourceUrl: 'https://alpha.example/plans'
        }
      ]
    },
    {
      id: 'beta',
      name: 'Beta Health',
      plans: [{
        id: 'beta-plan',
        name: 'Beta Silver',
        sourceUrl: 'https://beta.example/plans'
      }]
    }
  ]
};

function provider(id, overrides = {}) {
  return {
    id,
    npi: id,
    name: `Dr. Provider ${id}`,
    lastName: id,
    specialty: 'Dermatology',
    street: '100 West Main Street',
    suite: 'Suite 200',
    city: 'Minneapolis',
    state: 'MN',
    zip: '55106',
    location: '100 West Main Street, Suite 200, Minneapolis, MN',
    distanceMiles: 2,
    ...overrides
  };
}

function source(insurance, overrides = {}) {
  return {
    practice: 'Test Clinic',
    address: {
      street: '100 W Main St.',
      suite: 'Ste. 200',
      city: 'Minneapolis',
      state: 'MN',
      zip: '55106'
    },
    sourceType: 'clinic',
    sourceUrl: 'https://clinic.example/insurance',
    dateChecked: '2026-11-16',
    insurance,
    ...overrides
  };
}

function serviceFor(providers, insuranceSources = []) {
  const repository = {
    searchBySpecialtyAndZip: async (_specialty, state, zip) =>
      providers.filter(item => item.state === state && item.zip === zip),
    findById: async id => providers.find(item => item.id === id) ?? null
  };
  const distanceService = {
    geocodeLocation: async () => ({ latitude: 44.9, longitude: -93.2 }),
    milesBetweenAddresses: async (_origin, item) => item.distanceMiles
  };
  return new SpecialistService(
    repository,
    new BookingLinkService(),
    distanceService,
    insuranceSources,
    catalog
  );
}

const searchInput = {
  specialty: 'Dermatology',
  address: {
    city: 'Minneapolis',
    state: 'MN',
    zip: '55106'
  },
  maxDistance: 10
};

test('insurer-only listing appears for Any plan but not for a named plan', async () => {
  const item = provider('1111111111');
  const service = serviceFor([item], [
    source([{
      insurerId: 'alpha',
      insurer: 'Alpha Health',
      exactPlanName: null,
      planType: null,
      networkStatus: 'in'
    }])
  ]);

  const anyPlan = await service.search({
    ...searchInput,
    insurerId: 'alpha',
    planId: ''
  });
  const namedPlan = await service.search({
    ...searchInput,
    insurerId: 'alpha',
    planId: 'alpha-named'
  });

  assert.deepEqual(anyPlan.map(result => result.id), [item.id]);
  assert.equal(anyPlan[0].insuranceStatus, 'Insurer listed · Exact plan not verified');
  assert.deepEqual(namedPlan, []);
});

test('a Medicare Supplement listing does not match a Medicare Advantage plan', async () => {
  const item = provider('1111111111');
  const service = serviceFor([item], [
    source([{
      insurerId: 'alpha',
      insurer: 'Alpha Health',
      exactPlanName: null,
      planType: 'Medicare Supplement',
      networkStatus: 'in'
    }])
  ]);

  const results = await service.search({
    ...searchInput,
    insurerId: 'alpha',
    planId: 'alpha-other'
  });
  assert.deepEqual(results, []);
});

test('a plan type alone never satisfies a named-plan filter', async () => {
  const item = provider('1111111111');
  const service = serviceFor([item], [
    source([{
      insurerId: 'alpha',
      insurer: 'Alpha Health',
      exactPlanName: null,
      planType: 'Alpha Gold Choice',
      networkStatus: 'in'
    }])
  ]);

  assert.deepEqual(await service.search({
    ...searchInput,
    insurerId: 'alpha',
    planId: 'alpha-named'
  }), []);
});

test('a provider-specific source does not add insurance to another provider at the location', async () => {
  const listedProvider = provider('1111111111', { name: 'Provider A' });
  const otherProvider = provider('2222222222', { name: 'Provider B' });
  const service = serviceFor([listedProvider, otherProvider], [
    source([{
      insurerId: 'alpha',
      insurer: 'Alpha Health',
      exactPlanName: 'Alpha Gold Choice',
      networkStatus: 'in'
    }], {
      sourceType: 'provider',
      providerName: 'Provider A',
      npi: listedProvider.npi
    })
  ]);

  assert.equal(service.insuranceStatus(
    service.getInsuranceListings(listedProvider),
    'alpha',
    'alpha-named'
  ), 'Exact plan listed');
  assert.deepEqual(service.getInsuranceListings(otherProvider), []);
});

test('exact-plan filtering excludes unknown and out-of-network sources', async () => {
  const exact = provider('1111111111');
  const unknown = provider('2222222222', { street: '200 Other Street' });
  const outside = provider('3333333333', { street: '300 Other Street' });
  const service = serviceFor([exact, unknown, outside], [
    source([{
      insurerId: 'alpha',
      insurer: 'Alpha Health',
      exactPlanName: 'Alpha Gold Choice',
      networkStatus: 'in'
    }]),
    source([{
      insurerId: 'alpha',
      insurer: 'Alpha Health',
      exactPlanName: 'Alpha Gold Choice',
      networkStatus: 'out'
    }], {
      address: {
        street: '300 Other Street',
        suite: 'Suite 200',
        city: 'Minneapolis',
        state: 'MN',
        zip: '55106'
      }
    })
  ]);

  const results = await service.search({
    ...searchInput,
    insurerId: 'alpha',
    planId: 'alpha-named'
  });
  assert.deepEqual(results.map(result => result.id), [exact.id]);
  assert.equal(service.insuranceStatus(
    service.getInsuranceListings(outside),
    'alpha',
    ''
  ), 'Listed as out of network');
});

test('exact clinic address matching includes state and keeps NPI off public data', async () => {
  const item = provider('1111111111', { state: 'WI' });
  const service = serviceFor([item], [
    source([{
      insurerId: 'alpha',
      insurer: 'Alpha Health',
      exactPlanName: 'Alpha Gold Choice',
      networkStatus: 'in'
    }])
  ]);

  assert.deepEqual(service.getInsuranceListings(item), []);
  const noInsuranceService = serviceFor([provider('2222222222')]);
  const [result] = await noInsuranceService.search(searchInput);
  assert.equal(Object.hasOwn(result, 'npi'), false);
  assert.equal(result.insuranceStatus, 'Insurance information unavailable');
});

test('controller rejects a plan ID that belongs to a different insurer', async () => {
  let called = false;
  const controller = new ProviderController({
    search: async () => {
      called = true;
      return [];
    }
  }, catalog);
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
      street: '123 Main Street',
      city: 'Minneapolis',
      state: 'MN',
      zip: '55106',
      specialties: ['Dermatology'],
      insurerId: 'alpha',
      planId: 'beta-plan'
    }
  }, response);
  assert.equal(response.statusCode, 400);
  assert.equal(called, false);
});

test('catalog exposes stable insurer and plan IDs with official plan sources', () => {
  const controller = new ProviderController({}, catalog);
  const response = { json(payload) { this.payload = payload; } };
  controller.catalog({}, response);

  const insurers = response.payload.insuranceCatalog.insurers;
  assert.ok(insurers.some(insurer => insurer.id === 'alpha'));
  assert.ok(insurers[0].plans.every(plan =>
    plan.id && plan.name && plan.sourceUrl
  ));
});
