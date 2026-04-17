const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const {
  getUsers,
  listUsers,
  toggleUserActive,
  getArtisans,
  getArtisanDetail,
  verifyArtisan,
  rejectArtisan,
  warnArtisan,
  suspendArtisan,
  unsuspendArtisan,
  banArtisan,
  grantPro,
  revokePro,
  getJobs,
  getComplaints,
  resolveComplaint,
  resolveDispute,
  getDashboardStats,
} = require('../controllers/adminController');

// All admin routes — admin role only
router.use(protect, restrictTo('admin'));

// Dashboard
router.get('/stats', getDashboardStats);

// Users
router.get('/users', getUsers);
router.get('/users/list', listUsers);
router.post('/users/:userId/toggle-active', toggleUserActive);

// Artisans
router.get('/artisans', getArtisans);
router.get('/artisans/:artisanUserId', getArtisanDetail);
router.post('/artisans/:artisanUserId/verify', verifyArtisan);
router.post('/artisans/:artisanUserId/reject', rejectArtisan);
router.post('/artisans/:artisanUserId/warn', warnArtisan);
router.post('/artisans/:artisanUserId/suspend', suspendArtisan);
router.post('/artisans/:artisanUserId/unsuspend', unsuspendArtisan);
router.post('/artisans/:artisanUserId/ban', banArtisan);
router.post('/artisans/:artisanUserId/grant-pro', grantPro);
router.post('/artisans/:artisanUserId/revoke-pro', revokePro);

// Jobs
router.get('/jobs', getJobs);
router.post('/jobs/:jobId/resolve-dispute', resolveDispute);

// Complaints
router.get('/complaints', getComplaints);
router.post('/complaints/:complaintId/resolve', resolveComplaint);

module.exports = router;
