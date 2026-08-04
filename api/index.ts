export default (req: any, res: any) => {
  res.status(200).json({ message: 'API is up', url: req.url })
}
