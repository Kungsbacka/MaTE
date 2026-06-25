/**
 * Internationalization (i18n) Module
 *
 * Provides translations for the table editor UI.
 * Detects language from document.documentElement.lang (set by BookStack).
 */

export type TranslationStrings = Record<string, string>;


const translations: Record<string, TranslationStrings> = {
    'en': {
        // Modal
        'tableEditor': 'MaTE',
        'close': 'Close',

        // Toolbar buttons
        'undo': 'Undo',
        'redo': 'Redo',
        'addRowAbove': 'Add row above',
        'addRowBelow': 'Add row below',
        'moveRowUp': 'Move row up',
        'moveRowDown': 'Move row down',
        'addColumnLeft': 'Add column left',
        'addColumnRight': 'Add column right',
        'moveColumnLeft': 'Move column left',
        'moveColumnRight': 'Move column right',
        'deleteSelection': 'Delete selection',
        'pasteTable': 'Paste table',
        'copyToClipboard': 'Copy to clipboard',
        'outputFormat': 'Output format',
        'aligned': 'Aligned',
        'toggleAligned': 'Toggle aligned (padded) Markdown output',

        // Grid
        'selectAll': 'Select all',
        'selectColumn': 'Select column',
        'sortColumn': 'Sort column',
        'sortAscending': 'Sorted ascending (click for descending)',
        'sortDescending': 'Sorted descending (click to clear)',
        'alignmentLeft': 'left',
        'alignmentCenter': 'center',
        'alignmentRight': 'right',
        'alignment': 'Alignment',
        'clickToChange': 'click to change',
        'headerRow': 'Header row',
        'row': 'Row',
        'column': 'Column',
        'header': 'Header',

        // Footer
        'alignedOutput': 'Aligned output',
        'cancel': 'Cancel',
        'save': 'Save',

        // Dialogs
        'discardChanges': 'Discard changes to this table?',
        'discard': 'Discard',
        'continueEditing': 'Continue Editing',

        // Status
        'modified': 'Modified',
    },

    'sv': {
        // Modal
        'tableEditor': 'Tabellredigerare',
        'close': 'Stäng',

        // Toolbar buttons
        'undo': 'Ångra',
        'redo': 'Gör om',
        'addRowAbove': 'Lägg till rad ovanför',
        'addRowBelow': 'Lägg till rad nedanför',
        'moveRowUp': 'Flytta rad uppåt',
        'moveRowDown': 'Flytta rad nedåt',
        'addColumnLeft': 'Lägg till kolumn vänster',
        'addColumnRight': 'Lägg till kolumn höger',
        'moveColumnLeft': 'Flytta kolumn vänster',
        'moveColumnRight': 'Flytta kolumn höger',
        'deleteSelection': 'Ta bort markering',
        'pasteTable': 'Klistra in tabell',
        'copyToClipboard': 'Kopiera till urklipp',
        'outputFormat': 'Utdataformat',
        'aligned': 'Justerad',
        'toggleAligned': 'Växla justerad (utfylld) Markdown-utdata',

        // Grid
        'selectAll': 'Markera alla',
        'selectColumn': 'Välj kolumn',
        'sortColumn': 'Sortera kolumn',
        'sortAscending': 'Sorterad stigande (klicka för fallande)',
        'sortDescending': 'Sorterad fallande (klicka för att rensa)',
        'alignmentLeft': 'vänster',
        'alignmentCenter': 'centrerad',
        'alignmentRight': 'höger',
        'alignment': 'Justering',
        'clickToChange': 'klicka för att ändra',
        'headerRow': 'Rubrikrad',
        'row': 'Rad',
        'column': 'Kolumn',
        'header': 'Rubrik',

        // Footer
        'alignedOutput': 'Justerad utdata',
        'cancel': 'Avbryt',
        'save': 'Spara',

        // Dialogs
        'discardChanges': 'Vill du slänga ändringarna i tabellen?',
        'discard': 'Släng',
        'continueEditing': 'Fortsätt redigera',

        // Status
        'modified': 'Ändrad',
    }
};

/** Current language code */
let currentLanguage = 'en';

/**
 * Detects and sets the current language from the document.
 * Call this once at initialization.
 */
export function initLanguage() {
    const htmlLang = document.documentElement.lang || 'en';

    // Try full locale first (e.g., "sv-SE")
    if (translations[htmlLang]) {
        currentLanguage = htmlLang;
        return;
    }

    // Try base language (e.g., "sv" from "sv-SE")
    const baseLang = htmlLang.split('-')[0];
    if (translations[baseLang]) {
        currentLanguage = baseLang;
        return;
    }

    // Fall back to English
    currentLanguage = 'en';
}

/**
 * Gets a translated string.
 * @param replacements - Optional replacements for {placeholder} patterns
 * @returns The translated string, or the key if not found
 */
export function t(key: string, replacements: Record<string, string | number>= {}) {
    // Get translation from current language, fall back to English, fall back to key
    let text = translations[currentLanguage]?.[key]
        || translations['en']?.[key]
        || key;

    // Apply replacements
    for (const [placeholder, value] of Object.entries(replacements)) {
        text = text.replace(new RegExp(`\\{${placeholder}\\}`, 'g'), String(value));
    }

    return text;
}

/**
 * Gets the current language code.
 */
export function getCurrentLanguage() {
    return currentLanguage;
}

/**
 * Adds or updates translations for a language.
 * Useful for adding custom translations or new languages at runtime.
 * @param langCode - The language code (e.g., "de", "fr")
 * @param strings - The translation strings
 */
export function addTranslations(langCode: string, strings: TranslationStrings) {
    if (!translations[langCode]) {
        translations[langCode] = {};
    }
    Object.assign(translations[langCode], strings);
}

// Initialize language on module load
initLanguage();
