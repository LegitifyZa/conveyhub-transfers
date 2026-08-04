import app from '../server/index'

export default (req: any, res: any) => {
  const url = req.url || '/'
  const [pathname, ...rest] = url.split('?')
  const query = rest.length > 0 ? '?' + rest.join('?') : ''
  const trimmed = pathname === '/' ? '' : (pathname.startsWith('/') ? pathname.slice(1) : pathname)
  req.url = trimmed ? '/api/' + trimmed + query : '/api' + query
  return app(req, res)
}
