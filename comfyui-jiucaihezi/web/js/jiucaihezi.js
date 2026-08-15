import { app } from "../../../scripts/app.js";

const resolutions = {
  "gpt-image-2-1k": ["1k"],
  "gpt-image-2-低质量": ["1k", "2k", "4k"],
  "gpt-image-2-中质量": ["1k", "2k", "4k"],
  "gpt-image-2-vip": ["1k", "2k", "4k"],
  "gpt-image-2-官方": ["1k", "2k", "4k"],
  "gemini-3.1-flash-image-preview": ["1k", "2k"],
  "gemini-3-pro-image-preview": ["1k", "2k"],
};

app.registerExtension({
  name: "jiucaihezi.image-size",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "JiucaiheziImage") return;
    const original = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = original?.apply(this, arguments);
      const model = this.widgets.find((widget) => widget.name === "model");
      const resolution = this.widgets.find((widget) => widget.name === "resolution");
      const ratio = this.widgets.find((widget) => widget.name === "ratio");
      const update = (value) => {
        resolution.options.values = resolutions[value];
        if (!resolutions[value].includes(resolution.value)) resolution.value = resolutions[value][0];
        ratio.hidden = value.startsWith("gemini-");
        this.setDirtyCanvas(true);
      };
      const callback = model.callback;
      model.callback = (value) => { callback?.(value); update(value); };
      update(model.value);
      return result;
    };
  },
});
