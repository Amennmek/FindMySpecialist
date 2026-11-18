const demoProviders = require('../data/demoProviders.json');

class ProviderRepository {
  all() {
    return demoProviders.map(provider => ({
      ...provider,
      demoProvider: true
    }));
  }

  findById(id) {
    return this.all().find(provider => provider.id === id);
  }
}

module.exports = ProviderRepository;