(function(){
  const Engine = {
    state: {
      story: null,
      inventory: {},
      scene: null
    },

    async loadStory(path) {
      try {
        const res = await fetch(path, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.state.story = await res.json();
        return this.state.story;
      } catch (e) {
        console.warn('StoryEngine: failed to load story', e);
        this.state.story = null;
        return null;
      }
    },

    mergeWithQuestions(questionsJson) {
      // Simple merge: return questions as-is, story may provide defaults later
      return questionsJson;
    },

    handleTrigger(trigger, ctx) {
      // Minimal trigger router: { type: 'item'|'scene'|'background', key,value }
      if (!trigger || typeof trigger !== 'object') return;
      const t = trigger.type || trigger.action;
      if (t === 'item') {
        this.addItem(trigger.key || trigger.id || 'unknown', trigger.value ?? 1);
      } else if (t === 'scene') {
        this.setScene(trigger.key || trigger.name || 'default');
      } else if (t === 'background') {
        this.setBackground(trigger.key || trigger.url);
      }
    },

    addItem(key, delta = 1) {
      if (!key) return;
      const inv = this.state.inventory;
      inv[key] = (inv[key] || 0) + delta;
    },

    getInventory() {
      return { ...this.state.inventory };
    },

    setScene(name) {
      this.state.scene = name;
      // Scene transition hook; UI reaction handled by survey.js if needed
    },

    setBackground(url) {
      try {
        const bg = document.getElementById('background');
        if (bg && url) {
          bg.style.transition = 'background-image 300ms ease-in-out, opacity 200ms';
          bg.style.opacity = '0.2';
          setTimeout(() => {
            bg.style.backgroundImage = `url('${url}')`;
            bg.style.opacity = '1';
          }, 150);
        }
      } catch (_) {}
    }
  };

  window.StoryEngine = Engine;
})();
