function requireAuth(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }
  // API routes get JSON error, page routes get redirect
  if (req.path.startsWith('/api/') || req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(401).json({ success: false, message: 'يجب تسجيل الدخول أولاً' });
  }
  return res.redirect('/admin/login');
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.session && req.session.admin && req.session.admin.role === role) {
      return next();
    }
    if (req.path.startsWith('/api/') || req.xhr) {
      return res.status(403).json({ success: false, message: 'ليس لديك صلاحية' });
    }
    return res.status(403).render('admin/error', {
      title: 'غير مصرح',
      message: 'ليس لديك صلاحية للوصول إلى هذه الصفحة',
      admin: req.session ? req.session.admin : null
    });
  };
}

module.exports = { requireAuth, requireRole };
