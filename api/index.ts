export default async (req: any, res: any) => {
  try {
    const { default: app } = await import('../server/index')
    return app(req, res)
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err), stack: err?.stack })
  }
}
