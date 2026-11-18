
const zipCoordinates = require('../data/zipCoordinates.json');
const clinicBookingLinks = require('../data/clinicBookingLinks.json');
const clinicInsurance = require('../data/clinicInsurance.json');
const insuranceCatalog = require('../data/insuranceCatalog.json');
const { normalizePart, practiceAddressKey } = require('./PracticeAddress');
const { findPlan, getPlans, getInsurers } = require('./InsuranceCatalog');
const specialtyTaxonomies = require('../data/specialtyTaxonomy.json');

const EXACT_PLAN = 'Exact plan listed';
const PLAN_TYPE = 'Plan type listed · Exact plan not verified';
const INSURER_ONLY = 'Insurer listed · Exact plan not verified';
const UNAVAILABLE = 'Insurance information unavailable';
const OUT_OF_NETWORK = 'Listed as out of network';
const LISTINGS_AVAILABLE = 'Published insurance listings shown.';

function normalizeProviderName(value) {
  return normalizePart(value)
    .replace(/^(DR|DOCTOR)\s+/, '')
    .replace(/\s+(MD|DO|PHD|NP|PA)\s*$/, '');
}

class SpecialistService {
  constructor(
    repo,
    bookingLinks,
    distanceService,
    insuranceSources = clinicInsurance,
    catalog = insuranceCatalog
  ) {
    this.repo = repo;
    this.bookingLinks = bookingLinks;
    this.distanceService = distanceService;
    this.insuranceSources = insuranceSources;
    this.insuranceCatalog = catalog;
  }

  normalizeSpecialties(specialty, specialties = []) {
    const names = Array.isArray(specialties) ? [...specialties] : [];
    if (typeof specialty === 'string') names.push(specialty);

    return [...new Set(
      names
        .filter(name => typeof name === 'string')
        .map(name => name.trim())
        .filter(Boolean)
    )];
  }

  getInsuranceListings(provider) {
    const providerAddress = practiceAddressKey(provider);
    if (!providerAddress.replace(/\|/g, '')) return [];

    const matchedSources = this.insuranceSources
      .filter(source => practiceAddressKey(source.address) === providerAddress)
      .filter(source => {
        if (source.sourceType === 'clinic') return true;

        const providerNpi = String(provider.npi ?? provider.id ?? '');
        if (source.npi) return providerNpi === String(source.npi);

        return Boolean(provider.name && source.providerName) &&
          normalizeProviderName(provider.name) ===
          normalizeProviderName(source.providerName);
      });

    return matchedSources.flatMap(source => {
      const entries = source.insurance.map(entry => ({
        insurerId: entry.insurerId,
        insurer: entry.insurer,
        exactPlanName: entry.exactPlanName ?? null,
        planId: entry.planId ?? this.planIdForName(
          entry.insurerId,
          entry.exactPlanName
        ),
        planType: entry.planType ?? null,
        description: entry.description ?? null,
        networkStatus: entry.networkStatus,
        sourceType: source.sourceType,
        sourceUrl: source.sourceUrl,
        dateChecked: source.dateChecked
      }));

      if (!entries.length && source.generalStatement) {
        return [{
          insurerId: null,
          insurer: null,
          exactPlanName: null,
          planType: null,
          description: source.generalStatement,
          networkStatus: null,
          sourceType: source.sourceType,
          sourceUrl: source.sourceUrl,
          dateChecked: source.dateChecked
        }];
      }

      return entries;
    });
  }

  insuranceStatus(listings, insurerId, planId) {
    if (!insurerId) {
      return listings.length ? LISTINGS_AVAILABLE : UNAVAILABLE;
    }

    const matchingInsurer = listings.filter(listing =>
      listing.insurerId === insurerId
    );

    if (matchingInsurer.some(listing => listing.networkStatus === 'out')) {
      return OUT_OF_NETWORK;
    }

    const inNetworkListings = matchingInsurer.filter(
      listing => listing.networkStatus === 'in'
    );

    if (!inNetworkListings.length) return UNAVAILABLE;
    if (!planId) return INSURER_ONLY;

    const plan = findPlan(insurerId, planId, this.insuranceCatalog);

    if (inNetworkListings.some(listing =>
      listing.planId === plan.id ||
      (listing.exactPlanName &&
        normalizePart(listing.exactPlanName) === normalizePart(plan.name))
    )) return EXACT_PLAN;

    if (inNetworkListings.some(listing =>
      listing.planType &&
      normalizePart(listing.planType) === normalizePart(plan.name)
    )) return PLAN_TYPE;

    return INSURER_ONLY;
  }

  planIdForName(insurerId, planName) {
    if (!insurerId || !planName) return null;

    return getPlans(
      getInsurers(this.insuranceCatalog).find(
        insurer => insurer.id === insurerId
      )
    ).find(
      plan => normalizePart(plan.name) === normalizePart(planName)
    )?.id ?? null;
  }

  filterInsurance(providers, insurerId, planId) {
    if (!insurerId) return providers;

    return providers.filter(provider => {
      const status = this.insuranceStatus(
        provider.insuranceListings,
        insurerId,
        planId
      );

      return status === (planId ? EXACT_PLAN : INSURER_ONLY);
    });
  }

  publicProvider(provider) {
    const { npi, ...visibleProvider } = provider;
    return visibleProvider;
  }

  async search({
    specialty,
    specialties,
    address,
    maxDistance = '',
    insurerId = '',
    planId = ''
  } = {}) {
    const selected = this.normalizeSpecialties(specialty, specialties);

    if (!selected.length) {
      throw new Error('Choose a specialty.');
    }

    if (selected.some(name => !specialtyTaxonomies[name])) {
      throw new Error('Choose a supported specialty.');
    }

    const radius = maxDistance === '' ? 10 : Number(maxDistance);

    if (![5, 10, 15, 25, 50].includes(radius)) {
      throw new Error('Select a supported maximum distance.');
    }

    const origin = await this.distanceService.geocodeLocation(address);

    const zipDistance = point => {
      const rad = n => n * Math.PI / 180;
      const dLat = rad(point.latitude - origin.latitude);
      const dLon = rad(point.longitude - origin.longitude);

      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(origin.latitude)) *
        Math.cos(rad(point.latitude)) *
        Math.sin(dLon / 2) ** 2;

      return 3958.76 * 2 *
        Math.asin(Math.sqrt(Math.min(1, a)));
    };

    const nearbyZips = Object.entries(zipCoordinates)
      .filter(([, point]) => zipDistance(point) <= radius)
      .map(([zip]) => zip);

    if (!nearbyZips.includes(address.zip)) {
      nearbyZips.push(address.zip);
    }

    const queries = selected;
    const providersById = new Map();

    for (let start = 0; start < queries.length; start += 4) {
      const groups = await Promise.all(
        queries.slice(start, start + 4).map(specialty =>
          this.repo.searchBySpecialtyAndZip(
            specialty,
            address.state,
            address.zip,
            nearbyZips
          )
        )
      );

      for (const provider of groups.flat()) {
        if (
          provider.state === address.state &&
          !providersById.has(provider.id)
        ) {
          providersById.set(provider.id, provider);
        }
      }
    }

    const providers = [...providersById.values()];
    const mileageByAddress = new Map();

    const located = await Promise.all(
      providers.map(async provider => {
        const key = practiceAddressKey(provider);

        if (!mileageByAddress.has(key)) {
          mileageByAddress.set(
            key,
            this.distanceService.milesBetweenAddresses(
              origin,
              provider
            )
          );
        }

        let distanceMiles;

        try {
          distanceMiles = await mileageByAddress.get(key);
        } catch {
          return null;
        }

        if (!Number.isFinite(distanceMiles)) return null;
        if (distanceMiles > radius) return null;

        const insuranceListings =
          this.getInsuranceListings(provider);

        const result = {
          ...this.withClinicBooking(provider),
          insuranceListings,
          insuranceStatus: this.insuranceStatus(
            insuranceListings,
            insurerId,
            planId
          ),
          distanceMiles
        };

        return this.publicProvider(result);
      })
    );

    return this.filterInsurance(
      located.filter(Boolean),
      insurerId,
      planId
    ).sort((a, b) =>
      a.lastName.localeCompare(b.lastName) ||
      a.name.localeCompare(b.name)
    );
  }

  async details(id, {
    insurerId = '',
    planId = ''
  } = {}) {
    const provider = await this.repo.findById(id);

    if (!provider) return null;

    return {
      ...this.publicProvider({
        ...this.withClinicBooking(provider),
        insuranceListings:
          this.getInsuranceListings(provider),
        insuranceStatus: this.insuranceStatus(
          this.getInsuranceListings(provider),
          insurerId,
          planId
        )
      }),

      detailsStatus:
        provider.name &&
        provider.specialty &&
        provider.location
          ? 'Complete'
          : 'Partial'
    };
  }

  withClinicBooking(provider) {
    const clinic =
      clinicBookingLinks[practiceAddressKey(provider)];

    return {
      ...provider,
      clinic: clinic?.clinic ?? null,

      bookingUrl: this.bookingLinks.getBookingUrl(
        clinic?.bookingVerified === true
          ? clinic.bookingUrl
          : null
      ),

      bookingVerified:
        clinic?.bookingVerified === true &&
        this.bookingLinks.isValid(clinic?.bookingUrl),

      providerUrl: this.bookingLinks.getBookingUrl(
        clinic?.providerVerified === true
          ? clinic.providerUrl
          : null
      ),

      providerVerified:
        clinic?.providerVerified === true &&
        this.bookingLinks.isValid(clinic?.providerUrl)
    };
  }
}

module.exports = SpecialistService;
