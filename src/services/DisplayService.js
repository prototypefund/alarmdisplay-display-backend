const EventEmitter = require('events')
const log4js = require('log4js')

class DisplayService extends EventEmitter {
  /**
   * @param {DisplayRepository} displayRepository
   * @param {ViewRepository} viewRepository
   * @param {ContentSlotRepository} contentSlotRepository
   * @param {ContentSlotOptionRepository} contentSlotOptionRepository
   */
  constructor (displayRepository, viewRepository, contentSlotRepository, contentSlotOptionRepository) {
    super()
    this.displayRepository = displayRepository
    this.viewRepository = viewRepository
    this.contentSlotRepository = contentSlotRepository
    this.contentSlotOptionRepository = contentSlotOptionRepository
    this.logger = log4js.getLogger('DisplayService')
  }

  async createDisplay (name, active, clientId, description = '', location = '') {
    const id = await this.displayRepository.createDisplay(name, active, clientId, description, location)
    const newDisplay = await this.getDisplayById(id)
    this.emit('display_created', newDisplay)
    return newDisplay
  }

  async getAllDisplays () {
    return this.displayRepository.getAllDisplays()
  }

  async getDisplayById (displayId) {
    return this.displayRepository.getDisplayById(displayId)
  }

  async getDisplayByClientId (clientId) {
    return this.displayRepository.getDisplayByClientId(clientId)
  }

  getDisplaysForViews (viewIds) {
    return this.viewRepository.getViewsById(viewIds)
      .then(views => views.map(view => view.displayId))
      .then(displayIds => this.displayRepository.getDisplaysById(displayIds))
  }

  async deleteDisplay (displayId) {
    const result = await this.displayRepository.deleteDisplay(displayId)
    if (result) {
      this.emit('display_deleted', result)
    }

    return result
  }

  async updateDisplay (displayId, name, active, clientId, description, location) {
    const id = await this.displayRepository.updateDisplay(displayId, name, active, clientId, description, location)
    if (!id) {
      return this.getDisplayById(displayId)
    }

    const updatedDisplay = await this.getDisplayById(id)
    this.emit('display_updated', updatedDisplay)
    return updatedDisplay
  }

  /**
   * Creates a new View for a Display and appends it as the last View for that screen type.
   *
   * @param {String} name
   * @param {Number} columns
   * @param {Number} rows
   * @param {Number} displayId
   * @param {String} screenType
   *
   * @return {Promise}
   */
  createView (name, columns, rows, displayId, screenType) {
    return this.viewRepository.getViewsByDisplayIdAndScreenType(displayId, screenType)
      .then(views => {
        return this.viewRepository.createView(name, columns, rows, displayId, views.length + 1, screenType)
      })
  }

  /**
   * Returns the Views and their Content Slots for a specific Display.
   *
   * @param {Number} displayId The ID of the Display
   *
   * @return {Promise<Object[]>}
   */
  getViewsForDisplay (displayId) {
    return this.viewRepository.getViewsByDisplayId(displayId)
      .then(async views => {
        const enrichedViews = []
        for (const view of views) {
          view.contentSlots = await this.getContentSlotsForView(view.id)
          enrichedViews.push(view)
        }

        return enrichedViews
      })
  }

  getContentSlotsForView (viewId) {
    return this.contentSlotRepository.getContentSlotsByViewId(viewId)
      .then(async contentSlots => {
        const enrichedContentSlots = []
        for (const contentSlot of contentSlots) {
          const allOptions = await this.contentSlotOptionRepository.getOptionsForContentSlot(contentSlot.id)

          // Transform the Map to a regular object
          const options = {}
          for (const [key, value] of allOptions.entries()) {
            options[key] = value
          }

          contentSlot.options = options
          enrichedContentSlots.push(contentSlot)
        }

        return enrichedContentSlots
      })
  }

  /**
   * @param {Number} viewId
   * @return {Promise}
   */
  getView (viewId) {
    return Promise.all([
      this.viewRepository.getViewById(viewId),
      this.getContentSlotsForView(viewId)
    ])
      .then(([view, contentSlots]) => {
        view.contentSlots = contentSlots
        return view
      })
  }

  /**
   * @param {String} componentType
   *
   * @return {Promise<Object[]>}
   */
  getContentSlotsForComponentType (componentType) {
    return this.contentSlotRepository.getContentSlotsByComponentType(componentType)
  }

  /**
   * @param {Number} viewId
   *
   * @return {Promise}
   */
  deleteView (viewId) {
    return this.getView(viewId)
      .then(view => this.getDisplayById(view.displayId))
      .then(display => {
        return this.viewRepository.deleteView(viewId)
          .then(() => this.emit('views_updated', display))
          .catch(error => {
            // We don't really handle this error as it only affects the internal event, but not the update function
            this.logger.error(error)
          })
      })
  }

  /**
   * @param {Number} id
   * @param {String} name
   * @param {Number} columns
   * @param {Number} rows
   * @param {Object[]} contentSlots
   *
   * @return {Promise<Object>}
   */
  updateView (id, name, columns, rows, contentSlots) {
    return this.viewRepository.getViewById(id)
      .then(view => this.viewRepository.updateView(view.id, name, columns, rows, view.displayId, view.order, view.screenType))
      .then(updatedView => this.updateContentSlotsForView(updatedView.id, contentSlots))
      .then(() => {
        return this.getView(id)
          .then(updatedView => {
            this.getDisplayById(updatedView.displayId)
              .then(display => this.emit('views_updated', display))
              .catch(error => {
                // We don't really handle this error as it only affects the internal event, but not the update function
                this.logger.error(error)
              })

            return updatedView
          })
      })
  }

  updateContentSlotsForView (viewId, newContentSlots) {
    return this.contentSlotRepository.getContentSlotsByViewId(viewId)
      .then(async existingContentSlots => {
        const existingContentSlotIds = existingContentSlots.map(contentSlot => contentSlot.id)
        const submittedContentSlotIds = newContentSlots.filter(contentSlot => contentSlot.id !== undefined).map(contentSlot => contentSlot.id)
        const removedComponents = existingContentSlotIds.filter(id => !submittedContentSlotIds.includes(id))

        try {
          for (const contentSlotId of removedComponents) {
            await this.contentSlotOptionRepository.deleteOptionsForContentSlot(contentSlotId)
            await this.contentSlotRepository.deleteContentSlot(contentSlotId)
          }

          for (const contentSlot of newContentSlots) {
            if (contentSlot.id === undefined) {
              // Add a new Content Slot for this component
              const newContentSlot = await this.contentSlotRepository.createContentSlot(contentSlot.componentType, viewId, contentSlot.columnStart, contentSlot.rowStart, contentSlot.columnEnd, contentSlot.rowEnd)
              this.setOptionsForContentSlot(newContentSlot.id, contentSlot.options || {})
              continue
            }

            // Update an existing Content Slot
            const existingContentSlot = await this.contentSlotRepository.getContentSlot(contentSlot.id)
            await this.contentSlotRepository.updateContentSlot(existingContentSlot.id, contentSlot.componentType, viewId, contentSlot.columnStart, contentSlot.rowStart, contentSlot.columnEnd, contentSlot.rowEnd)
            this.setOptionsForContentSlot(existingContentSlot.id, contentSlot.options || {})
          }
        } catch (e) {
          return Promise.reject(e)
        }

        return Promise.resolve()
      })
  }

  setOptionsForContentSlot (contentSlotId, options = {}) {
    return this.contentSlotOptionRepository.getOptionsForContentSlot(contentSlotId)
      .then(async existingOptions => {
        // Remove existing options not present in the new options object
        for (const key of existingOptions.keys()) {
          if (!Object.prototype.hasOwnProperty.call(options, key)) {
            await this.contentSlotOptionRepository.deleteOption(contentSlotId, key)
          }
        }

        for (const [key, value] of Object.entries(options)) {
          if (existingOptions.has(key)) {
            await this.contentSlotOptionRepository.updateOption(contentSlotId, key, value)
            continue
          }

          await this.contentSlotOptionRepository.createOption(contentSlotId, key, value)
        }
      })
      .then(() => this.contentSlotOptionRepository.getOptionsForContentSlot(contentSlotId))
  }
}

module.exports = DisplayService
