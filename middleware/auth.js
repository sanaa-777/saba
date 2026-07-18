function requireAuth(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }
  return res.redirect('/admin/login');
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.session && req.session.admin && req.session.admin.role === role) {
      return next();
    }
    return res.status(403).render('admin/error', {
      title: 'غير مصرح',
      message: 'ليس لديك صلاحية للوصول إلى هذه الصفحة',
      admin: req.session ? req.session.admin : null
    });
  };
}

module.exports = { requireAuth, requireRole };
