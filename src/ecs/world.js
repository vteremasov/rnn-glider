export class World {
  constructor() {
    this.nextEntityId = 1;
    this.entities = new Set();
    this.components = new Map();
    this.resources = {};
  }

  createEntity() {
    const entity = this.nextEntityId++;
    this.entities.add(entity);
    return entity;
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

  addComponent(entity, name, value) {
    if (!this.entities.has(entity)) {
      throw new Error(`Unknown entity ${entity}`);
    }

    if (!this.components.has(name)) {
      this.components.set(name, new Map());
    }

    this.components.get(name).set(entity, value);
  }

  getComponent(entity, name) {
    const store = this.components.get(name);
    return store ? store.get(entity) : undefined;
  }

  query(...names) {
    if (names.length === 0) {
      return [];
    }

    const primary = this.components.get(names[0]);
    if (!primary) {
      return [];
    }

    const matches = [];
    for (const entity of primary.keys()) {
      let valid = true;
      for (let index = 1; index < names.length; index += 1) {
        const store = this.components.get(names[index]);
        if (!store || !store.has(entity)) {
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
