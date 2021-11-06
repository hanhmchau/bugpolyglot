/**
 * Shorthand for addSetting.
 * Default data: {scope: "world", config: true}
 * @function addSetting
 * @param {string} key
 * @param {object} data
 */
function addSetting (key, data) {
	const commonData = {
		scope: 'world',
		config: true
	}
	game.settings.register('polyglot', key, Object.assign(commonData, data))
}

class PolyGlot {

	constructor() {
		this.known_languages = new Set();
		this.literate_languages = new Set();
		this.refresh_timeout = null;
		this.alphabets = {common: '120% Dethek'}
		this.tongues = {_default: 'common'}
		this.allowOOC = false;
	}

	static async getLanguages() {
		const replaceLanguages = game.settings.get("polyglot","replaceLanguages");
		const langs = {};
		switch (game.system.id) {
			case "ose":
				return replaceLanguages ? [] : Object.fromEntries(CONFIG.OSE.languages.map(l => [l, l]));
			case "dcc":
				for (let item in CONFIG.DCC.languages) {
					langs[item] = game.i18n.localize(CONFIG.DCC.languages[item]);
				}
				return replaceLanguages ? {} : langs;
			case "demonlord":
				const demonlordPack = game.packs.get("demonlord.languages");
				const demonlordItemList = await demonlordPack.getIndex();
				for (let item of demonlordItemList) {
					langs[item.name] = game.i18n.localize(item.name);
				}
				return replaceLanguages ? {} : langs;
			case "dsa5":
				if (game.modules.get("dsa5-core")) {
					const dsa5Pack = game.packs.get("dsa5-core.corespecialabilites");
					const dsa5ItemList = await dsa5Pack.getIndex();
					for (let item of dsa5ItemList) {
						let myRegex = new RegExp(game.i18n.localize("LocalizedIDs.language")+'\\s*\\((.+)\\)', 'i');
						let match = item.name.match(myRegex);
						if (match) {
							let key = match[1].trim();
							langs[key] = key;
						}
						else {
							myRegex = new RegExp(game.i18n.localize("LocalizedIDs.literacy")+'\\s*\\((.+)\\)', 'i');
							match = item.name.match(myRegex);
							if (match) {
								let key = match[1].trim();
								langs[key] = key;
							}
						}
					}
				}
				return replaceLanguages ? {} : langs;
			case "pf2e":
				if (replaceLanguages) {
					CONFIG.PF2E.languages = {};
				}
				else {
					for (let lang in CONFIG.PF2E.languages) {
						langs[lang] = game.i18n.localize(CONFIG.PF2E.languages[lang]);
					}
				}
				return langs;
			case "wfrp4e":
				const wfrp4ePack = game.packs.get("wfrp4e-core.skills") || game.packs.get("wfrp4e.basic");
				const wfrp4eItemList = await wfrp4ePack.getIndex();
				for (let item of wfrp4eItemList) {
					let myRegex = new RegExp(game.i18n.localize("POLYGLOT.WFRP4E.LanguageSkills")+'\\s*\\((.+)\\)', 'i');
					const match = item.name.match(myRegex);
					if (match) {
						let key = match[1].trim().toLowerCase();
						langs[key] = key;
					}
				}
				return replaceLanguages ? {} : langs;
			case "tormenta20":
				if (replaceLanguages) {
					CONFIG.T20.idiomas = {};
				}
				return CONFIG.T20.idiomas;
			default:
				if (CONFIG[game.system.id.toUpperCase()]?.languages) {
					if (replaceLanguages)
						CONFIG[game.system.id.toUpperCase()].languages = {};
					return CONFIG[game.system.id.toUpperCase()].languages;
				}
				return [];
		}
	}
	static get languages() {
		return this._languages || {};
	}
	static set languages(val) {
		this._languages = val || {};
	}
	static get defaultLanguage() {
		const defaultLang = game.settings.get("polyglot", "defaultLanguage");
		if (defaultLang) {
			if (this.languages[defaultLang.toLowerCase()]) return defaultLang;
			const inverted = invertObject(this.languages);
			if (inverted[defaultLang]) return inverted[defaultLang.toLowerCase()];
		}
		if (!game.settings.get("polyglot", "replaceLanguages")) {
			switch (game.system.id) {
				case "aria":
					return game.i18n.localize("ARIA.languages.Common");
				case "dnd5e":
				case "dnd5eJP":
					return game.i18n.localize("DND5E.LanguagesCommon");
				case "dcc":
					return game.i18n.localize("DCC.LanguagesCommon");
				case "dsa5":
					return "Garethi";
				case "ose":
					return "Common";
				case "pf2e":
					return "common";
				case "sw5e":
					return game.i18n.localize("SW5E.LanguagesBasic");
				case "tormenta20":
					return "Comum";
				case "wfrp4e":
					return "Reikspiel";
			}
			const keys = Object.keys(this.languages)
			if (keys.includes("common") || keys.includes("Common")) return "Common";
		}
		return this.languages[0] || "";
	}

	async renderChatLog(chatlog, html, data) {
		await this.setCustomLanguages(game.settings.get("polyglot", "customLanguages"))
		const langString = "<div id='polyglot' class='polyglot-lang-select flexrow'><label>" + game.i18n.localize("POLYGLOT.LanguageLabel") + ": </label><select name='polyglot-language'></select></div>"
		const lang_html = $(langString);
		html.find("#chat-controls").after(lang_html);
		const select = html.find(".polyglot-lang-select select");
		select.change(e => {
			this.lastSelection = select.val();
		})
		this.updateUserLanguages(html);
	}

	updateUser(user, data) {
		if (user.id == game.user.id && data.character !== undefined) {
			this.updateUserLanguages(ui.chat.element)
			this.updateChatMessages()
		}
	}

	controlToken() {
		this.updateUserLanguages(ui.chat.element)
		this.updateChatMessages()
	}

	updateChatMessages() {
		// Delay refresh because switching tokens could cause a controlToken(false) then controlToken(true) very fast
		if (this.refresh_timeout)
			clearTimeout(this.refresh_timeout)
		this.refresh_timeout = setTimeout(this.updateChatMessagesDelayed.bind(this), 500)
	}

	_isMessageTypeOOC(type){
		return [CONST.CHAT_MESSAGE_TYPES.OOC, CONST.CHAT_MESSAGE_TYPES.WHISPER].includes(type);
	}

	updateChatMessagesDelayed() {
		this.refresh_timeout = null;
		// Get the last 100 messages
		const messages = ui.chat.element.find('.message').slice(-100).toArray().map(m => game.messages.get(m.dataset.messageId))
		// Loop in reverse so most recent messages get refreshed first.
		for (let i = messages.length - 1; i >= 0; i--) {
			let message = messages[i]
			if (message && (message.data.type == CONST.CHAT_MESSAGE_TYPES.IC || this._isMessageTypeOOC(message.data.type))) {
				let lang = message.getFlag("polyglot", "language") || ""
				let unknown = lang != this.truespeech && !this.known_languages.has(lang) && !this.known_languages.has(this.comprehendLanguages);
				if (game.user.isGM && !game.settings.get("polyglot", "runifyGM")) {
					// Update globe color
					const globe = ui.chat.element.find(`.message[data-message-id="${message.id}"] .message-metadata .polyglot-message-language i`)
					const color = unknown ? "red" : "green";
					globe.css({color});
					unknown = false;
				}
				if (unknown != message.polyglot_unknown)
					ui.chat.updateMessage(message)
			}
		}
	}

	updateUserLanguages(html) {
		let actors = [];
		this.known_languages = new Set();
		this.literate_languages = new Set();
		if (canvas && canvas.tokens) {
			for (let token of canvas.tokens.controlled) {
				if (token.actor)
					actors.push(token.actor);
			}
		}
		if (actors.length == 0 && game.user.character)
			actors.push(game.user.character);
		for (let actor of actors) {
			try {
				switch (game.system.id) {
					case "aria":
						this.known_languages.add(game.i18n.localize("ARIA.languages.Common"));
						for (let lang of actor.data.items)
						{
							if (lang.data.language)
								this.known_languages.add(lang.name.toLowerCase())
						}
						break;
					case "CoC7":
						for (let item of actor.data.items) {
							const match = 
								item.name.match(game.i18n.localize("POLYGLOT.COC7.LanguageOwn")+'\\s*\\((.+)\\)', 'i')
								|| item.name.match(game.i18n.localize("POLYGLOT.COC7.LanguageAny")+'\\s*\\((.+)\\)', 'i')
								|| item.name.match(game.i18n.localize("POLYGLOT.COC7.LanguageOther")+'\\s*\\((.+)\\)', 'i');
							// adding only the descriptive language name, not "Language (XYZ)"
							if (match)
								this.known_languages.add(match[1].trim().toLowerCase());
							else if ([game.i18n.localize("POLYGLOT.COC7.LanguageSpec"), game.i18n.localize("POLYGLOT.COC7.LanguageOwn"), game.i18n.localize("POLYGLOT.COC7.LanguageAny"), game.i18n.localize("POLYGLOT.COC7.LanguageOther"), game.i18n.localize("CoC7.language"), "Language", "Language (Own)", "Language (Other)"].includes(item.data.specialization))
								this.known_languages.add(item.name.trim().toLowerCase());
						}
						break;
					case "wfrp4e":
						for (let item of actor.data.items) {
							let myRegex = new RegExp(game.i18n.localize("POLYGLOT.WFRP4E.LanguageSkills")+'\\s*\\((.+)\\)', 'i');
							const match = item.name.match(myRegex);
							// adding only the descriptive language name, not "Language (XYZ)"
							if (match)
								this.known_languages.add(match[1].trim().toLowerCase());
						}
						break;
					case "swade":
						for (let item of actor.data.items) {
							const name = item?.flags?.babele?.originalName || item.name;
							const match = item.name.match(/Language \((.+)\)/i);
							// adding only the descriptive language name, not "Language (XYZ)"
							if (match)
								this.known_languages.add(match[1].trim().toLowerCase());
						}
						break;
					case "dcc":
						for (let lang of actor.data.data.details.languages.split(/[,;]/))
							this.known_languages.add(lang.trim().toLowerCase());
						break;
					case "demonlord":
						for (let item of actor.data.items) {
							if (item.type === "language") {
								if (item.data.speak)
									this.known_languages.add(item.name);
								if (item.data.read)
									this.literate_languages.add(item.name);
							}
						}
						break;
					case "dsa5":
						for (let item of actor.data.items) {
							if (item.data.category?.value === "language") {
								let myRegex = new RegExp(game.i18n.localize("LocalizedIDs.language")+'\\s*\\((.+)\\)', 'i');
								let match = item.name.match(myRegex);
								if (match) {
									this.known_languages.add(match[1].trim());
								}
								else {
									myRegex = new RegExp(game.i18n.localize("LocalizedIDs.literacy")+'\\s*\\((.+)\\)', 'i');
									match = item.name.match(myRegex);
									if (match) {
										this.literate_languages.add(match[1].trim());
									}
								}
							}
						}
						break;
					case "ose":
						for (let lang of actor.data.data.languages.value)
							this.known_languages.add(lang)
						break;
					case "tormenta20":
						for (let lang of actor.data.data.detalhes.idiomas.value)
							this.known_languages.add(lang)
						break;
					default:
						// Don't duplicate the value in case it's a not an array
						for (let lang of actor.data.data.traits.languages.value)
							this.known_languages.add(lang)
						// This condition is needed so an empty language is not loaded
						if (actor.data.data.traits.languages.custom != "") {
							for (let lang of actor.data.data.traits.languages.custom.split(/[,;]/))
								this.known_languages.add(lang.trim().toLowerCase());
						}
						break;
				}
			} catch (err) {
				// Maybe not dnd5e, pf1 or pf2e or corrupted actor data?
			}
		}
		if (this.known_languages.size == 0) {
			if (game.user.isGM)
				this.known_languages = new Set(Object.keys(PolyGlot.languages))
			else
				this.known_languages.add(PolyGlot.defaultLanguage);
		}
		let options = ""
		for (let lang of this.known_languages) {
			if (lang != this.truespeech && lang === this.comprehendLanguages) continue;
			let label = PolyGlot.languages[lang] || lang
			options += `<option value="${lang}">${label}</option>`
		}
		const select = html.find(".polyglot-lang-select select");
		const prevOption = select.val();
		select.html($(options));
		
		let defaultLanguage = PolyGlot.defaultLanguage.toLowerCase();
		let selectedLanguage = this.lastSelection || prevOption || defaultLanguage;
		// known_languages is a Set, so it's weird to access its values
		if (!this.known_languages.has(selectedLanguage))
			selectedLanguage = (this.known_languages.has(defaultLanguage) ? defaultLanguage : [...this.known_languages][0]);

		select.val(selectedLanguage);
	}

	// Original code from https://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
	hashCode(string) {
		let hash = 0;
		for (let i = 0; i < string.length; i++) {
			const char = string.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash;
		}
		return hash;
	}

	scrambleString(string, salt) {
		const salted_string = string + salt;
		// Use a seeded PRNG to get consistent scrambled results
		const rng = new MersenneTwister(this.hashCode(salted_string));
		return string.replace(/\S/gu, () => {
			// Generate 0-9a-z
			const c = Math.floor(rng.random()*36).toString(36)
			const upper = Boolean(Math.round(rng.random()));
			return upper ? c.toUpperCase() : c;
			});
	}

	async renderChatMessage(message, html, data) {
		await new Promise(r => setTimeout(r, 0));
		const lang = message.getFlag("polyglot", "language") || ""
		if (!lang) return;
		let metadata = html.find(".message-metadata")
		let language = PolyGlot.languages[lang] || lang
		const known = this.known_languages.has(lang); //Actor knows the language rather than being affected by Comprehend Languages or Tongues
		const runifyGM = game.settings.get("polyglot", "runifyGM");
		const displayTranslated = game.settings.get('polyglot', 'display-translated');
		const hideTranslation = game.settings.get('polyglot','hideTranslation');
		if (game.user.isGM && !runifyGM)
			message.polyglot_unknown = false;
		else
			message.polyglot_unknown = lang != this.truespeech && !known && !this.known_languages.has(this.truespeech) && !this.known_languages.has(this.comprehendLanguages);
		
		let new_content = this.scrambleString(message.data.content, game.settings.get('polyglot','useUniqueSalt') ? message.data._id : lang)
		if(displayTranslated && (language != PolyGlot.defaultLanguage || message.polyglot_unknown)) {
			let content = html.find(".message-content");
			let translation = message.data.content;
			let original = $('<div>').addClass('polyglot-original-text').css({font:this._getFontStyle(lang)}).html(new_content);
			$(content).empty().append(original);
			
			if (message.polyglot_force || !message.polyglot_unknown) {
				if (message.polyglot_force || (lang != this.truespeech && !message.polyglot_unknown && (game.user.isGM || !hideTranslation))) {
					$(content).append($('<div>').addClass('polyglot-translation-text').attr('title', game.i18n.localize("POLYGLOT.TranslatedFrom") + language).html(translation));
				}
				else {
					$(content).append($('<div>').addClass('polyglot-translation-text').attr('title', game.i18n.localize("POLYGLOT.Translation")).html(translation));
				}
			}
		}
		else if (!message.polyglot_force && message.polyglot_unknown) {
			let content = html.find(".message-content")
			content.text(new_content)
			content[0].style.font = this._getFontStyle(lang)
			message.polyglot_unknown = true;
		}
		
		if (game.user.isGM || !hideTranslation) {
			const color = known ?	"green" : "red";
			metadata.find(".polyglot-message-language").remove()
			const title = game.user.isGM || !known ? `title="${language}"` : ""
			let button = $(`<a class="button polyglot-message-language" ${title}>
				<i class="fas fa-globe" style="color:${color}"></i>
			</a>`)
			metadata.append(button)
			if (game.user.isGM && (runifyGM || !displayTranslated)) {
				button.click(this._onGlobeClick.bind(this))
			}
		}
		setTimeout(() => {
			ui.chat.scrollBottom();
		}, 10);
	}

	_onGlobeClick(event) {
		event.preventDefault();
		const li = $(event.currentTarget).parents('.message');
		const message = Messages.instance.get(li.data("messageId"));
		message.polyglot_force = !message.polyglot_force;
		ui.chat.updateMessage(message)
	}

	preCreateChatMessage(data, options, userId) {
		if (data.type == CONST.CHAT_MESSAGE_TYPES.IC || (this.allowOOC && this._isMessageTypeOOC(data.type) && game.user.isGM)) {
			let lang = ui.chat.element.find("select[name=polyglot-language]").val()
			if (lang != "")
				mergeObject(data, { "flags.polyglot.language": lang });
		}
	}

	_getFontStyle(lang) {
		return this.alphabets[this.tongues[lang]] || this.alphabets[this.tongues._default]
	}

	async loadLanguages(setting) {
		const response = await fetch(`modules/polyglot/settings/${setting}.json`);
		if (response.ok) {
			const settingInfo = await response.json();
			this.alphabets = settingInfo.alphabets;
			this.tongues = settingInfo.tongues;
			console.log(`Polyglot | Loaded ${setting}.json`);
		} else {
			console.error(`Polyglot | Failed to fetch ${setting}.json: ${response.status}`);
			return;
		}
	}

	setup() {
		switch (game.system.id) {
			case "aria":
				this.loadLanguages("aria");
				break;
			case "dcc":
				this.loadLanguages("dcc");
				break;
			case "D35E":
			case "dnd5e":
			case "dnd5eJP":
			case "kryx_rpg":
				this.loadLanguages("forgottenrealms");
				break;
			case "demonlord":
				this.loadLanguages("demonlord");
				break;
			case "dsa5":
				this.loadLanguages("dsa5");
				break;
			case "ose":
				this.loadLanguages("ose");
				break;
			case "pf1":
			case "pf2e":
				this.loadLanguages("golarion");
				break;
			case "wfrp4e":
				this.loadLanguages("wfrp");
				break;
			case "tormenta20":
				this.loadLanguages("tormenta20");
				break;
			case "sfrpg":
				this.loadLanguages("starfinder");
				break;
			case "sw5e":
				this.loadLanguages("sw5e");
				break;
		}
		game.settings.register('polyglot', "defaultLanguage", {
			name: game.i18n.localize("POLYGLOT.DefaultLanguageTitle"),
			hint: game.i18n.localize("POLYGLOT.DefaultLanguageHint"),
			scope: "client",
			config: true,
			default: "",
			type: String
		});
		addSetting("useUniqueSalt", {
			name: game.i18n.localize("POLYGLOT.RandomizeRunesTitle"),
			hint: game.i18n.localize("POLYGLOT.RandomizeRunesHint"),
			default: false,
			type: Boolean,
			onChange: () => location.reload()
		});
		addSetting("exportFonts", {
			name: game.i18n.localize("POLYGLOT.ExportFontsTitle"),
			hint: game.i18n.localize("POLYGLOT.ExportFontsHint"),
			default: true,
			type: Boolean,
			onChange: () => this.updateConfigFonts()
		});
		
		//Language Settings
		addSetting("replaceLanguages", {
			name: game.i18n.localize("POLYGLOT.ReplaceLanguagesTitle"),
			hint: game.i18n.localize("POLYGLOT.ReplaceLanguagesHint"),
			default: false,
			type: Boolean,
			onChange: () => location.reload()
		});
		addSetting("customLanguages", {
			name: game.i18n.localize("POLYGLOT.CustomLanguagesTitle"),
			hint: game.i18n.localize("POLYGLOT.CustomLanguagesHint"),
			default: "",
			type: String,
			onChange: (value) => this.setCustomLanguages(value)
		});
		addSetting("comprehendLanguages", {
			name: game.i18n.localize("POLYGLOT.ComprehendLanguagesTitle"),
			hint: game.i18n.localize("POLYGLOT.ComprehendLanguagesHint"),
			default: "",
			type: String,
			onChange: (value) => this.comprehendLanguages = value.trim().toLowerCase().replace(/ \'/g, "_")
		});
		addSetting("truespeech", {
			name: game.i18n.localize("POLYGLOT.TruespeechTitle"),
			hint: game.i18n.localize("POLYGLOT.TruespeechHint"),
			default: "",
			type: String,
			onChange: (value) => this.truespeech = game.settings.get("polyglot","truespeech").trim().toLowerCase().replace(/ \'/g, "_")
		});

		//Chat Settings
		addSetting("display-translated", {
			name: game.i18n.localize("POLYGLOT.DisplayTranslatedTitle"),
			hint: game.i18n.localize("POLYGLOT.DisplayTranslatedHint"),
			default: true,
			type: Boolean
		});
		addSetting("hideTranslation", {
			name: game.i18n.localize("POLYGLOT.HideTranslationTitle"),
			hint: game.i18n.localize("POLYGLOT.HideTranslationHint"),
			default: false,
			type: Boolean,
			onChange: () => location.reload()
		});
		addSetting("allowOOC", {
			name: game.i18n.localize("POLYGLOT.AllowOOCTitle"),
			hint: game.i18n.localize("POLYGLOT.AllowOOCHint"),
			default: false,
			type: Boolean,
			onChange: (value) => this.allowOOC = value
		});
		addSetting("runifyGM", {
			name: game.i18n.localize("POLYGLOT.ScrambleGMTitle"),
			hint: game.i18n.localize("POLYGLOT.ScrambleGMHint"),
			default: true,
			type: Boolean,
			onChange: () => location.reload()
		});
		// Adjust the bubble dimensions so the message is displayed correctly
		ChatBubbles.prototype._getMessageDimensions = (message) => {
			let div = $(`<div class="chat-bubble" style="visibility:hidden;font:${this._bubble.font}">${this._bubble.message || message}</div>`);
			$('body').append(div);
			let dims = {
				width: div[0].clientWidth + 8,
				height: div[0].clientHeight
			};
			div.css({maxHeight: "none"});
			dims.unconstrained = div[0].clientHeight;
			div.remove();
			return dims;
		}
		// allow OOC talking
		this.allowOOC = game.settings.get("polyglot","allowOOC");
		this.comprehendLanguages = game.settings.get("polyglot","comprehendLanguages").trim().toLowerCase().replace(/ \'/g, "_");
		this.truespeech = game.settings.get("polyglot","truespeech").trim().toLowerCase().replace(/ \'/g, "_");
	}
	
	ready() {
		this.updateConfigFonts();
		this.setCustomLanguages(game.settings.get("polyglot","customLanguages"));
	}
	
	updateConfigFonts() {
		// Register fonts so they are available to other elements (such as Drawings)
		
		// First, remove all our fonts, then add them again if needed.
		CONFIG.fontFamilies = CONFIG.fontFamilies.filter(f => !PolyGlot.FONTS.includes(f));
		if (game.settings.get("polyglot", "exportFonts")) {
			CONFIG.fontFamilies.push(...PolyGlot.FONTS);
		}
	}

	async setCustomLanguages(languages) {
		PolyGlot.languages = await PolyGlot.getLanguages();
		if (languages != "") {
			for (let lang of languages.split(",")) {
				lang = lang.trim();
				const key = lang.toLowerCase().replace(/ \'/g, "_");
				if (game.system.id === "pf2e") {
					CONFIG.PF2E.languages[key] = lang;
				}
				PolyGlot.languages[key] = lang;
			}
		}
		this.updateUserLanguages(ui.chat.element);
	}

	_addPolyglotEditor(sheet) {
		if (sheet._polyglotEditor) return;
		const methodName = sheet.activateEditor ? "activateEditor" : "_createEditor"
		sheet._polyglot_original_activateEditor = sheet[methodName];
		let langs = PolyGlot.languages;
		if (!game.user.isGM) {
			langs = {};
			for (let lang of this.known_languages) {
				langs[lang] = PolyGlot.languages[lang];
			}
			for (let lang of this.literate_languages) {
				langs[lang] = PolyGlot.languages[lang];
			}
		}
		const languages = Object.entries(langs).map(([lang, name]) => {
			return {
				title: name || "",
				inline: 'span',
				classes: 'polyglot-journal',
				attributes: {
					title: name || "",
					"data-language": lang || ""
				}
			};
		});
		if (this.truespeech) {
			const truespeechIndex = languages.findIndex(element => element.attributes["data-language"] == this.truespeech);
			languages.splice(truespeechIndex, 1);
		}
		if (this.comprehendLanguages && this.comprehendLanguages != this.truespeech) {
			const comprehendLanguagesIndex = languages.findIndex(element => element.attributes["data-language"] == this.comprehendLanguages);
			languages.splice(comprehendLanguagesIndex, 1);
		}
		sheet[methodName] = function(target, editorOptions, initialContent) {
			editorOptions.style_formats = [
				...CONFIG.TinyMCE.style_formats,
				{
				title: "Polyglot",
				items: languages
				}
			];
			editorOptions.formats = {
				removeformat: [
					// Default remove format configuration from tinyMCE
					{
						selector: 'b,strong,em,i,font,u,strike,sub,sup,dfn,code,samp,kbd,var,cite,mark,q,del,ins',
						remove: 'all',
						split: true,
						expand: false,
						block_expand: true,
						deep: true
					},
					{
						selector: 'span',
						attributes: [
						'style',
						'class'
						],
						remove: 'empty',
						split: true,
						expand: false,
						deep: true
					},
					{
						selector: '*',
						attributes: [
						'style',
						'class'
						],
						split: false,
						expand: false,
						deep: true
					},
					// Add custom config to remove spans from polyglot when needed
					{
						selector: 'span',
						classes: 'polyglot-journal',
						attributes: ['title', 'class', 'data-language'],
						remove: 'all',
						split: true,
						expand: false,
						deep: true
					},
				]
			};
			return this._polyglot_original_activateEditor(target, editorOptions, initialContent);
		}
		sheet._polyglotEditor = true;
	}

	renderJournalSheet(journalSheet, html) {
		this._addPolyglotEditor(journalSheet);
		if (journalSheet.entity.owner || game.user.isGM) {
			let runes = false;
			const texts = [];
			const styles = [];
			const toggleString = "<a class='polyglot-button' title='Polyglot: " + game.i18n.localize("POLYGLOT.ToggleRunes") + "'><i class='fas fa-unlink'></i></a>";
			const toggleButton = $(toggleString);
			toggleButton.click(ev => {
				ev.preventDefault();
				let button = ev.currentTarget.firstChild
				runes = !runes
				button.className = runes ? 'fas fa-link' : 'fas fa-unlink';
				const spans = journalSheet.element.find("span.polyglot-journal");
				if (runes) {
					for (let span of spans.toArray()) {
						const lang = span.dataset.language;
						if (!lang) continue;
						texts.push(span.textContent)
						styles.push(span.style.font)
						span.textContent = this.scrambleString(span.textContent, game.settings.get('polyglot','useUniqueSalt') ? journalSheet._id : lang)
						span.style.font = this._getFontStyle(lang)
					}
				}
				else {
					let i = 0;
					for (let span of spans.toArray()) {
						const lang = span.dataset.language;
						if (!lang) continue;
						span.textContent = texts[i]
						span.style.font = styles[i]
						i++;
					}
				}
			});
			html.closest('.app').find('.polyglot-button').remove();
			const titleElement = html.closest('.app').find('.window-title');
			toggleButton.insertAfter(titleElement);
			return;
		}
		const spans = journalSheet.element.find("span.polyglot-journal");
		for (let span of spans.toArray()) {
			const lang = span.dataset.language;
			if (!lang) continue;
			let conditions = lang != this.truespeech && !this.known_languages.has(this.comprehendLanguages);
			switch (game.system.id) {
				case "demonlord":
				case "dsa5":
					conditions = conditions && !this.literate_languages.has(lang);
					break;
				default:
					conditions = conditions && !this.known_languages.has(lang);
					break;
			}
			if (conditions) {
				span.title = "????"
				span.textContent = this.scrambleString(span.textContent,game.settings.get('polyglot','useUniqueSalt') ? journalSheet._id : lang)
				span.style.font = this._getFontStyle(lang)
			}
		}
	}
	
	chatBubble (token, html, messageContent, {emote}) {
		const message = game.messages.entities.slice(-10).reverse().find(m => m.data.content === messageContent);
		this._bubble = { font: '', message: '' };
		if (message.data.type == CONST.CHAT_MESSAGE_TYPES.IC) {
			let lang = message.getFlag("polyglot", "language") || ""
			if (lang != "") {
				const unknown = lang != this.truespeech && !this.known_languages.has(lang) && !this.known_languages.has(this.comprehendLanguages);
				message.polyglot_unknown = unknown;
				if (game.user.isGM && !game.settings.get("polyglot", "runifyGM"))
					message.polyglot_unknown = false;
				if (!message.polyglot_force && message.polyglot_unknown) {
					const content = html.find(".bubble-content")
					const new_content = this.scrambleString(message.data.content, game.settings.get('polyglot','useUniqueSalt') ? message._id : lang)
					content.text(new_content)
					this._bubble.font = this._getFontStyle(lang)
					this._bubble.message = new_content
					content[0].style.font = this._bubble.font
					message.polyglot_unknown = true;
				}
			}
		}
	}
	
	vinoChatRender (chatDisplayData) {
		const message = chatDisplayData.message;

		let lang = message.getFlag("polyglot", "language") || ""
		if (lang != "") {
			const unknown = lang != this.truespeech && !this.known_languages.has(lang) && !this.known_languages.has(this.comprehendLanguages);
			message.polyglot_unknown = unknown;
			if (game.user.isGM && !game.settings.get("polyglot", "runifyGM"))
				message.polyglot_unknown = false;
			if (!message.polyglot_force && message.polyglot_unknown) {
				const new_content = this.scrambleString(chatDisplayData.text, game.settings.get('polyglot','useUniqueSalt') ? message._id : lang)
				chatDisplayData.text = new_content;
				chatDisplayData.font = this._getFontStyle(lang)
				chatDisplayData.skipAutoQuote = true;
				message.polyglot_unknown = true;
			}
		}
	}
}

PolyGlot.FONTS = [
	"ArCiela",
	"Barazhad", 
	"Celestial",
	"DarkEldar", 
	"Dethek", 
	"ElderFuthark", 
	"Eltharin", 
	"Espruar", 
	"Floki", 
	"FingerAlphabet", 
	"HighDrowic", 
	"HighschoolRunes", 
	"Infernal", 
	"Iokharic", 
	"JungleSlang", 
	"Kargi", 
	"MarasEye", 
	"MeroiticDemotic", 
	"MiroslavNormal", 
	"OldeEspruar", 
	"OldeThorass", 
	"Ophidian", 
	"Pulsian", 
	"Oriental", 
	"OrkGlyphs", 
	"Qijomi", 
	"Reanaarian", 
	"Saurian", 
	"Semphari", 
	"Skaven", 
	"Tengwar", 
	"Thassilonian", 
	"Thorass", 
	"Tuzluca", 
	"Valmaric"
];

let PolyGlotSingleton = new PolyGlot()

Hooks.on('renderChatLog', PolyGlotSingleton.renderChatLog.bind(PolyGlotSingleton))
Hooks.on('updateUser', PolyGlotSingleton.updateUser.bind(PolyGlotSingleton))
Hooks.on('controlToken', PolyGlotSingleton.controlToken.bind(PolyGlotSingleton))
Hooks.on('preCreateChatMessage', PolyGlotSingleton.preCreateChatMessage.bind(PolyGlotSingleton))
Hooks.on('renderChatMessage', PolyGlotSingleton.renderChatMessage.bind(PolyGlotSingleton))
Hooks.on('renderJournalSheet', PolyGlotSingleton.renderJournalSheet.bind(PolyGlotSingleton))
Hooks.on('setup', PolyGlotSingleton.setup.bind(PolyGlotSingleton))
Hooks.on('ready', PolyGlotSingleton.ready.bind(PolyGlotSingleton))
Hooks.on("chatBubble", PolyGlotSingleton.chatBubble.bind(PolyGlotSingleton)) //token, html, message, {emote}
Hooks.on("vinoPrepareChatDisplayData", PolyGlotSingleton.vinoChatRender.bind(PolyGlotSingleton))
Hooks.on("renderSettingsConfig", (app, html, data) => {
    $('<div>').addClass('form-group polyglot-group-header').html(game.i18n.localize("POLYGLOT.LanguageSettings")).insertBefore($('[name="polyglot.replaceLanguages"]').parents('div.form-group:first'));
    $('<div>').addClass('form-group polyglot-group-header').html(game.i18n.localize("POLYGLOT.ChatSettings")).insertBefore($('[name="polyglot.display-translated"]').parents('div.form-group:first'));
});