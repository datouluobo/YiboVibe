import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import translationEN from './locales/en.json';
import translationZH from './locales/zh.json';

const resources = {
    en: {
        translation: translationEN
    },
    zh: {
        translation: translationZH
    }
};

const savedLang = localStorage.getItem('yibovibe_lang') || 'zh';

i18n
    .use(initReactI18next)
    .init({
        resources,
        lng: savedLang,
        fallbackLng: 'en',
        interpolation: {
            escapeValue: false
        }
    });

export default i18n;
