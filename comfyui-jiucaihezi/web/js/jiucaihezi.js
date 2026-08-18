import { app } from "../../../scripts/app.js";

const gptRatios = ["1:1", "2:3", "3:2", "4:5", "5:4", "4:3", "3:4", "16:9", "9:16", "21:9"];
const geminiRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"];
const resolutions = {
  "gpt-image-2-1k": ["1k"],
  "gpt-image-2-低质量": ["1k", "2k", "4k"],
  "gpt-image-2-中质量": ["1k", "2k", "4k"],
  "gpt-image-2-vip": ["1k", "2k", "4k"],
  "gpt-image-2-官方": ["1k", "2k", "4k"],
  "gemini-3.1-flash-image-preview": ["1k", "2k", "4k"],
  "gemini-3-pro-image-preview": ["1k", "2k", "4k"],
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
        ratio.options.values = value.startsWith("gemini-") ? geminiRatios : gptRatios;
        if (!ratio.options.values.includes(ratio.value)) ratio.value = ratio.options.values[0];
        this.setDirtyCanvas(true);
      };
      const callback = model.callback;
      model.callback = (value) => { callback?.(value); update(value); };
      update(model.value);
      return result;
    };
  },
});
