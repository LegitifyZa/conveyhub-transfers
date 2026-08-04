import app from '../server/index'

export default (req: any, res: any) => {
  const url = req.url || '/'

  if (url === '/' || url === '') {
    req.url = '/api'
  } else if (!url.startsWith('/api/') && url !== '/api') {
    req.url = url.startsWith('/') ? '/api' + url : '/api/' + url
  }

  return app(req, res)
}
