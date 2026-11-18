const NPPES_API = 'https://npiregistry.cms.hhs.gov/api/';
const taxonomyMappings = require('../data/specialtyTaxonomy.json');

class NppesProviderRepository {
  constructor({ fetchImpl = globalThis.fetch, taxonomies = taxonomyMappings } = {}) {
    this.fetchImpl = fetchImpl;
    this.taxonomies = taxonomies;
  }

  // Search each nearby ZIP prefix, rather than only the first statewide page.
  // NPPES supports postal_code prefix wildcards (e.g. 551*).
  async searchBySpecialtyAndZip(specialty, state, zip, nearbyZips = [zip]) {
    const terms = this.taxonomies[specialty];
    if (!terms?.length) throw new Error('No NPPES taxonomy mapping exists for this specialty.');

    const prefixes = [...new Set(nearbyZips.map(value => String(value).slice(0, 3)))]
      .filter(value => /^\d{3}$/.test(value));
    const providers = new Map();
    // Bound the number of simultaneous requests to avoid flooding the API.
    const jobs = terms.flatMap(term => prefixes.map(prefix => ({ term, prefix })));
    for (let index = 0; index < jobs.length; index += 4) {
      const batches = await Promise.all(jobs.slice(index, index + 4).map(async ({ term, prefix }) => {
        const found = [];
        for (let skip = 0; skip <= 800; skip += 200) {
          const page = await this.fetchRecords({
            enumeration_type: 'NPI-1', taxonomy_description: term,
            state, postal_code: `${prefix}*`, address_purpose: 'LOCATION',
            limit: '200', skip: String(skip)
          });
          found.push(...page);
          if (page.length < 200) break;
        }
        return found;
      }));
      for (const record of batches.flat()) {
        if (record.basic?.status === 'D') continue;
        const provider = this.toProvider(record, specialty);
        if (provider.state !== state) continue;
        // Do not exclude a ZIP merely because it is absent from the local cache.
        // SpecialistService checks the actual ZIP-area distance afterward.
        providers.set(provider.id, provider);
      }
    }
    return [...providers.values()];
  }

  async findById(id) {
    if (!/^\d{10}$/.test(id)) return null;

    const [record] = await this.fetchRecords({
      number: id,
      enumeration_type: 'NPI-1'
    });

    if (!record || record.basic?.status === 'D') return null;
    return this.toProvider(record);
  }

  async fetchRecords(filters) {
    const url = new URL(NPPES_API);
    url.search = new URLSearchParams({ version: '2.1', ...filters });

    const response = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      throw new Error(`NPPES request failed (HTTP ${response.status}).`);
    }

    const data = await response.json();
    if (data.Errors?.length) {
      throw new Error('NPPES rejected the provider search.');
    }
    if (Array.isArray(data.results)) return data.results;
    if (data.result_count === 0) return [];

    throw new Error('NPPES returned an unexpected response.');
  }

  toProvider(record, requestedSpecialty) {
    const { first_name, last_name } = record.basic ?? {};
    const practice = record.addresses?.find(
      address => address.address_purpose === 'LOCATION'
    );
    const taxonomies = record.taxonomies ?? [];
    const taxonomy = taxonomies.find(item => item.primary) ?? taxonomies[0];

    const street = practice?.address_1 ?? '';
    const suite = practice?.address_2 ?? '';
    const city = practice?.city ?? '';
    const state = practice?.state ?? '';
    const zip = practice?.postal_code?.slice(0, 5) ?? '';
    const cityAndState = [city, state].filter(Boolean).join(', ');
    const location = [street, suite, cityAndState].filter(Boolean).join(', ');

    return {
      id: String(record.number),
      npi: String(record.number),
      name: [first_name, last_name].filter(Boolean).join(' '),
      lastName: last_name ?? '',
      specialty: requestedSpecialty ?? taxonomy?.desc ?? '',
      location,
      street,
      suite,
      city,
      state,
      zip,
      phone: practice?.telephone_number ?? null,
      clinic: null,
      distanceMiles: null,
      insurance: {},
      bookingUrl: null,
      demoProvider: false
    };
  }
}

module.exports = NppesProviderRepository;
