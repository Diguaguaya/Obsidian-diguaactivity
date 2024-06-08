import {
	App,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder
} from "obsidian";

interface InitSettings {
	defaultFolder: string;
	excludedFolders: string[];
	yamlProperty: string;
	propertyFolderMap: { [propertyValue: string]: string };
	tagFolderMap: { [tag: string]: string };
}

const DEFAULT_SETTINGS: InitSettings = {
	defaultFolder: "",
	excludedFolders: [],
	yamlProperty: "moveto",
	propertyFolderMap: {},
	tagFolderMap: {},
};

export default class MoveNotePlugin extends Plugin {
	settings: InitSettings;

	async onload() {
		console.log("loading MoveNote plugin");

		await this.loadSettings();

		this.addCommand({
			id: "move-note",
			name: "移动当前笔记",
			callback: async () => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile) {
					this.openFolderSelectModal(activeFile);
				} else {
					new Notice("没有活动文件");
				}
			},
		});

		this.addRibbonIcon("paper-plane", "移动当前笔记", async () => {
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				this.openFolderSelectModal(activeFile);
			} else {
				new Notice("没有活动文件");
			}
		});

		this.addSettingTab(new MoveNoteSettingTab(this.app, this));

		this.registerEvent(this.app.metadataCache.on("changed", this.handleMetadataChange.bind(this)));

		// 在侧栏中添加一个按钮，用于移动当前编辑的笔记
		this.addButtonToSidebar();
	}

	onunload() {
		console.log("unloading MoveNote plugin");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async handleMetadataChange(file: TFile) {
		const yaml = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!yaml) return;

		// 处理属性映射
		const propertyValue = yaml[this.settings.yamlProperty];
		if (propertyValue && this.settings.propertyFolderMap[propertyValue]) {
			const targetFolder = this.settings.propertyFolderMap[propertyValue];
			const newPath = `${targetFolder}/${file.name}`;
			try {
				await this.app.vault.rename(file, newPath);
				new Notice(`文件已根据属性 ${this.settings.yamlProperty}=${propertyValue} 移动到 ${newPath}`);
				return;
			} catch (error) {
				new Notice(`根据属性移动文件失败: ${error.message}`);
			}
		}

		// 处理标签映射
		const tags = yaml["tags"];
		if (tags) {
			const tagList = Array.isArray(tags) ? tags : [tags];
			for (const tag of tagList) {
				if (this.settings.tagFolderMap[tag]) {
					const targetFolder = this.settings.tagFolderMap[tag];
					const newPath = `${targetFolder}/${file.name}`;
					try {
						await this.app.vault.rename(file, newPath);
						new Notice(`文件已根据标签 ${tag} 移动到 ${newPath}`);
						return;
					} catch (error) {
						new Notice(`根据标签移动文件失败: ${error.message}`);
					}
				}
			}
		}
	}

	private openFolderSelectModal(file: TFile) {
		new FolderSelectModal(this.app, this.settings.defaultFolder, this.settings.excludedFolders, async (selectedFolderPath: string) => {
			if (selectedFolderPath) {
				const newPath = `${selectedFolderPath}/${file.name}`;
				try {
					await this.app.vault.rename(file, newPath);
					new Notice(`文件已移动到 ${newPath}`);
				} catch (error) {
					new Notice(`移动文件失败: ${error.message}`);
				}
			} else {
				new Notice("未选择目标文件夹");
			}
		}).open();
	}

	private addButtonToSidebar() {
		const ribbonIconEl = this.addRibbonIcon("paper-plane", "移动当前编辑的笔记", async () => {
			const activeLeaf = this.app.workspace.activeLeaf;
			if (activeLeaf && activeLeaf.view.getViewType() === "markdown") {
				const activeFile = activeLeaf.view.file;
				if (activeFile) {
					this.openFolderSelectModal(activeFile);
				} else {
					new Notice("没有活动文件");
				}
			} else {
				new Notice("当前视图不是 Markdown 文件");
			}
		});
		ribbonIconEl.addClass("move-note-ribbon-icon");
	}
}

class FolderSelectModal extends Modal {
	private defaultFolder: string;
	private excludedFolders: string[];
	private onSelect: (selectedFolderPath: string) => void;
	private folderSelect: HTMLSelectElement | undefined;

	constructor(app: App, defaultFolder: string, excludedFolders: string[], onSelect: (selectedFolderPath: string) => void) {
		super(app);
		this.defaultFolder = defaultFolder;
		this.excludedFolders = excludedFolders;
		this.onSelect = onSelect;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "选择目标文件夹" });

		this.folderSelect = contentEl.createEl("select");
		this.folderSelect.style.width = "100%";

		const folders = this.app.vault.getAllLoadedFiles().filter(file => file instanceof TFolder) as TFolder[];
		const includedFolders = this.filterExcludedFolders(folders, this.excludedFolders);
		includedFolders.forEach(folder => {
			const option = this.folderSelect.createEl("option", { text: folder.path });
			option.value = folder.path;
		});

		this.folderSelect.focus();

		this.folderSelect.addEventListener("change", (event: Event) => {
			const selectedPath = (event.target as HTMLSelectElement).value;
			this.onSelect(selectedPath);
			this.close();
		});
	}

	onClose() {
		this.folderSelect = undefined;
	}

	private filterExcludedFolders(folders: TFolder[], excludedFolders: string[]): TFolder[] {
		return folders.filter(folder => {
			return !excludedFolders.some(excludedFolder => {
				return folder.path.startsWith(excludedFolder);
			});
		});
	}
}

class MoveNoteSettingTab extends PluginSettingTab {
	plugin: MoveNotePlugin;

	constructor(app: App, plugin: MoveNotePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		let { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Move Note Plugin Settings" });

		new Setting(containerEl)
			.setName("默认文件夹")
			.setDesc("用于在移动笔记时预填的默认文件夹")
			.addText(text => text
				.setPlaceholder("Enter your default folder")
				.setValue(this.plugin.settings.defaultFolder)
				.onChange(async (value) => {
					this.plugin.settings.defaultFolder = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("排除的文件夹")
			.setDesc("在选择目标文件夹时排除的文件夹列表")
			.addButton(button => {
				button.setButtonText("+").onClick(() => {
					this.plugin.settings.excludedFolders.push("");
					this.display();
				});
			});

		this.plugin.settings.excludedFolders.forEach((folder, index) => {
			new Setting(containerEl)
				.addDropdown(dropdown => {
					const folders = this.plugin.app.vault.getAllLoadedFiles().filter(file => file instanceof TFolder) as TFolder[];
					folders.forEach(f => dropdown.addOption(f.path, f.path));
					dropdown.setValue(folder).onChange(async (value) => {
						this.plugin.settings.excludedFolders[index] = value;
						await this.plugin.saveSettings();
					});
				})
				.addExtraButton(extraButton => {
					extraButton.setIcon("trash").onClick(() => {
						this.plugin.settings.excludedFolders.splice(index, 1);
						this.display();
					});
				});
		});

		containerEl.createEl("h2", { text: "YAML 属性和文件夹映射" });

		new Setting(containerEl)
			.setName("YAML 属性名")
			.setDesc("用于在 YAML 区域中指定目标文件夹的自定义属性名")
			.addText(text => text
				.setPlaceholder("Enter YAML property name")
				.setValue(this.plugin.settings.yamlProperty)
				.onChange(async (value) => {
					this.plugin.settings.yamlProperty = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("添加新的属性映射")
			.addButton(button => {
				button.setButtonText("+").onClick(() => {
					this.plugin.settings.propertyFolderMap[`new_property_${Object.keys(this.plugin.settings.propertyFolderMap).length}`] = "";
					this.display();
				});
			});

		Object.entries(this.plugin.settings.propertyFolderMap).forEach(([propertyValue, folder], index) => {			const propertyFolderSetting = new Setting(containerEl);

			propertyFolderSetting
				.setName(`属性 ${index + 1}`)
				.addText(text => {
					text.setPlaceholder("输入属性值")
						.setValue(propertyValue)
						.onChange(async (value) => {
							const newPropertyFolderMap = { ...this.plugin.settings.propertyFolderMap };
							delete newPropertyFolderMap[propertyValue];
							newPropertyFolderMap[value] = folder;
							this.plugin.settings.propertyFolderMap = newPropertyFolderMap;
							await this.plugin.saveSettings();
						});
				})
				.addText(text => {
					text.setPlaceholder("输入目标文件夹")
						.setValue(folder)
						.onChange(async (value) => {
							this.plugin.settings.propertyFolderMap[propertyValue] = value;
							await this.plugin.saveSettings();
						});
				})
				.addExtraButton(extraButton => {
					extraButton.setIcon("trash").onClick(async () => {
						delete this.plugin.settings.propertyFolderMap[propertyValue];
						this.display();
						await this.plugin.saveSettings();
					});
				});
		});

		containerEl.createEl("h2", { text: "标签和文件夹映射" });

		new Setting(containerEl)
			.setName("添加新的标签映射")
			.addButton(button => {
				button.setButtonText("+").onClick(() => {
					this.plugin.settings.tagFolderMap[`new_tag_${Object.keys(this.plugin.settings.tagFolderMap).length}`] = "";
					this.display();
				});
			});

		Object.entries(this.plugin.settings.tagFolderMap).forEach(([tag, folder], index) => {
			const tagFolderSetting = new Setting(containerEl);

			tagFolderSetting
				.setName(`标签 ${index + 1}`)
				.addText(text => {
					text.setPlaceholder("输入标签")
						.setValue(tag)
						.onChange(async (value) => {
							const newTagFolderMap = { ...this.plugin.settings.tagFolderMap };
							delete newTagFolderMap[tag];
							newTagFolderMap[value] = folder;
							this.plugin.settings.tagFolderMap = newTagFolderMap;
							await this.plugin.saveSettings();
						});
				})
				.addText(text => {
					text.setPlaceholder("输入目标文件夹")
						.setValue(folder)
						.onChange(async (value) => {
							this.plugin.settings.tagFolderMap[tag] = value;
							await this.plugin.saveSettings();
						});
				})
				.addExtraButton(extraButton => {
					extraButton.setIcon("trash").onClick(async () => {
						delete this.plugin.settings.tagFolderMap[tag];
						this.display();
						await this.plugin.saveSettings();
					});
				});
		});
	}
}