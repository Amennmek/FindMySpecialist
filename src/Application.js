const express = require('express');
const session = require('express-session');
const path = require('node:path');

const UserRepository = require('./repositories/UserRepository');
const NppesProviderRepository = require('./repositories/NppesProviderRepository');

const AuthService = require('./services/AuthService');
const SymptomService = require('./services/SymptomService');
const MatchingService = require('./services/MatchingService');
const SpecialistService = require('./services/SpecialistService');
const BookingLinkService = require('./services/BookingLinkService');
const DistanceService = require('./DistanceService');

const AuthController = require('./controllers/AuthController');
const IntakeController = require('./controllers/IntakeController');
const MatchController = require('./controllers/MatchController');
const ProviderController = require('./controllers/ProviderController');

const insuranceCatalog = require('./data/insuranceCatalog.json');

class Application {
  constructor() {
    this.app = express();
    this.configure();
  }

  configure() {
    const app = this.app;

    app.use(express.json());
    app.use(session({
      secret: process.env.SESSION_SECRET || 'development-only-change-this-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 4
      }
    }));

    const auth = new AuthController(new AuthService(new UserRepository()));
    const symptoms = new SymptomService();
    const intake = new IntakeController(symptoms);
    const match = new MatchController(new MatchingService(symptoms));

    const specialistService = new SpecialistService(
      new NppesProviderRepository(),
      new BookingLinkService(),
      new DistanceService()
    );
    const providers = new ProviderController(specialistService, insuranceCatalog);

    app.post('/api/auth/register', auth.register);
    app.post('/api/auth/login', auth.login);
    app.post('/api/auth/guest', auth.guest);
    app.get('/api/auth/me', auth.me);
    app.post('/api/auth/preferences', auth.save);
    app.post('/api/auth/logout', auth.logout);

    const requireAccess = (req, res, next) => {
      if (req.session?.userId || req.session?.accessType === 'Guest') {
        return next();
      }

      return res.status(401).json({
        message: 'Continue as a guest or log in to access this feature.'
      });
    };

    app.use([
      '/api/symptoms',
      '/api/intake',
      '/api/match',
      '/api/catalog',
      '/api/providers'
    ], requireAccess);

    app.get('/api/symptoms', intake.search);
    app.post('/api/intake/symptoms', intake.submit);
    app.post('/api/match', match.match);

    app.get('/api/catalog', providers.catalog);
    app.post('/api/providers/search', providers.search);
    app.get('/api/providers/:id', providers.details);

    app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

    const protectedPages = new Set([
      '/intake.html',
      '/match.html',
      '/specialists.html',
      '/details.html'
    ]);

    app.use((req, res, next) => {
      if (!protectedPages.has(req.path)) return next();
      if (req.session?.userId || req.session?.accessType === 'Guest') {
        return next();
      }

      return res.redirect('/index.html?authRequired=1');
    });

    app.use(express.static(path.join(__dirname, '../public')));
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });

    app.use((err, req, res, next) => {
      res.status(500).json({ message: 'Unexpected server error' });
    });
  }
}

module.exports = Application;