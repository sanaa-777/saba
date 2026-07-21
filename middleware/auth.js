function requireAuth(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }
  // API routes get JSON error, page routes get redirect
  const requestPath = req.originalUrl || req.path || '';
  if (requestPath.startsWith('/api/') || req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(401).json({ success: false, message: 'يجب تسجيل الدخول أولاً' });
  }
  return res.redirect('/admin/login');
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.session && req.session.admin && req.session.admin.role === role) {
      return next();
    }
    const requestPath = req.originalUrl || req.path || '';
    if (requestPath.startsWith('/api/') || req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
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
