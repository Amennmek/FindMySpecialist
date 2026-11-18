const insuranceCatalog = require('../data/insuranceCatalog.json');

function getInsurers(catalog = insuranceCatalog) {
  return Array.isArray(catalog.insurers)
    ? catalog.insurers
    : Object.entries(catalog.insurers).map(([id, insurer]) => ({
      id,
      ...insurer
    }));
}

function findInsurer(id, catalog = insuranceCatalog) {
  return getInsurers(catalog).find(insurer => insurer.id === id) ?? null;
}

function getPlans(insurer) {
  if (!insurer) return [];
  return Array.isArray(insurer.plans)
    ? insurer.plans
    : Object.entries(insurer.plans ?? {}).map(([id, plan]) => ({
      id,
      ...plan
    }));
}

function findPlan(insurerId, planId, catalog = insuranceCatalog) {
  return getPlans(findInsurer(insurerId, catalog))
    .find(plan => plan.id === planId) ?? null;
}

function validateSelection(insurerId = '', planId = '', catalog = insuranceCatalog) {
  if (!insurerId && !planId) {
    return { valid: true, insurer: null, plan: null };
  }

  const insurer = findInsurer(insurerId, catalog);
  if (!insurer) {
    return {
      valid: false,
      message: 'Select an insurer from the insurance catalog.'
    };
  }

  const plan = planId ? findPlan(insurerId, planId, catalog) : null;
  if (planId && !plan) {
    return {
      valid: false,
      message: 'Select a plan belonging to the chosen insurer.'
    };
  }

  return { valid: true, insurer, plan };
}

module.exports = {
  insuranceCatalog,
  getInsurers,
  getPlans,
  findInsurer,
  findPlan,
  validateSelection
};
