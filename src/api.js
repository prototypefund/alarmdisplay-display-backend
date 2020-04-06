const express = require('express')
const log4js = require('log4js')

module.exports = class APIv1 {
  /**
   * @param {DisplayService} displayService
   */
  constructor (displayService) {
    this.logger = log4js.getLogger('APIv1')
    this.router = express.Router()
    this.router.use(express.json())

    // Register the routes and their handlers
    const displayRoutes = require('./routes/displays')(displayService)
    this.router.use('/displays', displayRoutes)

    // Add our own error handler to override the built-in one
    // eslint-disable-next-line no-unused-vars
    this.router.use((err, req, res, next) => {
      this.logger.error(err)
      res.status(500).json({ error: { message: err.message } })
    })
  }
}
