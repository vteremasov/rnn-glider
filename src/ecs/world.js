export class World {
  constructor() {
    this.nextEntityId = 1;
    this.entities = new Set();
    this.components = new Map();
    this.resources = {};
  }

  createEntity() {
    const id = this.nextEntityId++;
    this.entities.add(id);
    return id;
  }

  destroyEntity(entity) {
    if (!this.entities.has(entity)) {
      return;
    }

    this.entities.delete(entity);
    for (const store of this.components.values()) {
      store.delete(entity);
    }
  }

  addComponent(entity, name, data) {
    if (!this.entities.has(entity)) {
      throw new Error(`Entity ${entity} does not exist`);
    }

    if (!this.components.has(name)) {
      this.components.set(name, new Map());
    }

    this.components.get(name).set(entity, data);
  }

  getComponent(entity, name) {
    return this.components.get(name)?.get(entity);
  }

  hasComponent(entity, name) {
    return this.components.get(name)?.has(entity) ?? false;
  }

  removeComponent(entity, name) {
    this.components.get(name)?.delete(entity);
  }

  query(...componentNames) {
    if (componentNames.length === 0) {
      return [];
    }

    const primary = this.components.get(componentNames[0]);
    if (!primary) {
      return [];
    }

    const matches = [];
    for (const entity of primary.keys()) {
      let valid = true;
      for (let i = 1; i < componentNames.length; i += 1) {
        if (!this.components.get(componentNames[i])?.has(entity)) {
          valid = false;
          break;
        }
      }
      if (valid) {
        matches.push(entity);
      }
    }

    return matches;
  }
}
