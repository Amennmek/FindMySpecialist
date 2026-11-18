const {
  getInsurers,
  validateSelection
} = require('../services/InsuranceCatalog');
const insuranceCatalog = require('../data/insuranceCatalog.json');

const STATE_CODE = /^[A-Z]{2}$/;
const ZIP_CODE = /^\d{5}$/;

class ProviderController {
  constructor(specialistService, catalog = insuranceCatalog) {
    this.specialistService = specialistService;
    this.insuranceCatalog = catalog;
    this.search = this.search.bind(this);
    this.details = this.details.bind(this);
    this.catalog = this.catalog.bind(this);
  }

  catalog(req, res) {
    return res.json({
      insuranceCatalog: {
        insurers: getInsurers(this.insuranceCatalog)
      }
    });
  }

  validateAddress(body = {}) {
    const address = {
      city: typeof body.city === 'string' ? body.city.trim() : '',
      state: typeof body.state === 'string' ? body.state.trim().toUpperCase() : '',
      zip: typeof body.zip === 'string' ? body.zip.trim() : ''
    };

    if (!address.city || address.city.length > 100 || !STATE_CODE.test(address.state) || !ZIP_CODE.test(address.zip)) {
      return { error: 'Enter a city, two-letter state, and five-digit ZIP code.' };
    }

    return { address };
  }

  validateDistance(value) {
    const distance = value === undefined || value === '' ? 10 : Number(value);
    return [5, 10, 15, 25, 50].includes(distance) ? distance : null;
  }

  async search(req, res) {
    const { address, error: addressError } = this.validateAddress(req.body);
    if (addressError) return res.status(400).json({ error: addressError });

    const maxDistance = this.validateDistance(req.body.maxDistance);
    if (maxDistance === null) {
      return res.status(400).json({ error: 'Select a supported maximum distance.' });
    }

    const insurerId = typeof req.body.insurerId === 'string'
      ? req.body.insurerId
      : '';
    const planId = typeof req.body.planId === 'string' ? req.body.planId : '';
    if (!validateSelection(insurerId, planId, this.insuranceCatalog).valid) {
      return res.status(400).json({
        error: 'Select a valid insurance provider and plan combination.'
      });
    }

    const specialties = Array.isArray(req.body.specialties)
      ? req.body.specialties
      : [req.body.specialty].filter(Boolean);

    try {
      const results = await this.specialistService.search({
        specialties,
        address,
        maxDistance,
        insurerId,
        planId
      });
      return res.json({
        results,
        noResultsMessage: results.length === 0 && insurerId
          ? (planId
            ? 'No providers with a published match for this insurance plan.'
            : 'No providers with a published match for this insurance.')
          : null
      });
    } catch (error) {
      if (error.code === 'ADDRESS_NOT_FOUND' ||
          error.code === 'ADDRESS_MISMATCH') {
        return res.status(422).json({ error: error.message });
      }
      if (error.message === 'Choose a specialty.' ||
          error.message === 'Choose a supported specialty.') {
        return res.status(400).json({ error: error.message });
      }
      return res.status(502).json({
        error: 'Provider search is temporarily unavailable. Please try again.'
      });
    }
  }

  async details(req, res) {
    const insurerId = typeof req.query.insurerId === 'string'
      ? req.query.insurerId
      : '';
    const planId = typeof req.query.planId === 'string' ? req.query.planId : '';
    if (!validateSelection(insurerId, planId, this.insuranceCatalog).valid) {
      return res.status(400).json({
        error: 'Select a valid insurance provider and plan combination.'
      });
    }

    try {
      const provider = await this.specialistService.details(req.params.id, {
        insurerId,
        planId
      });
      if (!provider) {
        return res.status(404).json({ error: 'Provider not found.' });
      }
      return res.json(provider);
    } catch {
      return res.status(502).json({
        error: 'Provider details are temporarily unavailable. Please try again.'
      });
    }
  }
}

module.exports = ProviderController;
