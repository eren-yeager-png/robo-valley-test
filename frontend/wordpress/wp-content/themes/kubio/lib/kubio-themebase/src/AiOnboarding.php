<?php

namespace Kubio\Theme;


use Kubio\Theme\Panels\AiOnboardingPanel;
use Kubio\Theme\Flags;
use Kubio\Theme\ReactAssetsRegistry;
use ColibriWP\Theme\Core\Hooks;
use ColibriWP\Theme\Defaults;

class AiOnboarding
{
	use Singleton;

	protected function __construct()
	{
		add_action('after_setup_theme', array($this, 'init_ai_onboarding_panel'));

		Hooks::add_wp_ajax(
			'ai_onboarding_disable_notice',
			array($this, 'on_disable_ai_onboarding_notice')
		);

		Hooks::add_wp_ajax(
			'ai_onboarding_start_generating',
			array($this, 'on_start_generating_ai_onboarding')
		);

	    add_action('customize_save_after', array($this, 'remove_ai_notice_on_customizer_publish'));
	}

    function getIsDismissedFlag() {
        $template = get_stylesheet();
        return "kubio_get_ai_onboarding_notice_dismissed__$template";
    }

	function remove_ai_notice_on_customizer_publish($wp_customize) {
		$published = isset($_POST['customize_changeset_status']) && $_POST['customize_changeset_status'] === 'publish';
		if (!$published) {
			return;
		}

		//if anything changes in the customizer remove the ai notice
		//This also handles the case with theme preview to the current theme and publish. For this use case do not show the notice
		//Because you may change some content then on the next refresh you ll be hit with a notice to get started after you already changed many things
		if (!Flags::get($this->getIsDismissedFlag())) {
			Flags::set($this->getIsDismissedFlag(), true);
		}
	}

    function getThemeHasChanges() {
        $theme_options = get_option('theme_mods_' . get_option('stylesheet'));
        if(empty($theme_options)) {
            return false;
        }
        if(is_array($theme_options) && count($theme_options) > 3) {
            return true;
        }

        return false;
    }
	function init_ai_onboarding_panel()
	{
		//return;
		//Flags::set( $this->getIsDismissedFlag(), false);
		if (Flags::get($this->getIsDismissedFlag())) {
			return;
		}
        if($this->getThemeHasChanges()) {
            return;
        }
        //if the kubio plugin is active don't show the panel
        if( apply_filters( 'kubio_is_enabled', false )) {
            return;
        }
		add_action('customize_register', array($this, 'register_onboarding_panel'), 0);
		add_action('customize_controls_enqueue_scripts', array($this, 'register_onboarding_panel_resources'));
	}
	function on_disable_ai_onboarding_notice()
	{
		check_ajax_referer('ai_onboarding_nonce');
		Flags::set($this->getIsDismissedFlag(), true);
		wp_send_json_success();
	}

	function on_start_generating_ai_onboarding()
	{
		check_ajax_referer('ai_onboarding_nonce');
		$site_context = isset($_REQUEST['site_context']) ? $_REQUEST['site_context'] : null;
		if (empty($site_context)) {
			wp_send_json_error('site_context not found');
		}
        $frontPageIndex = isset($site_context['frontPageIndex']) ? $site_context['frontPageIndex'] : null;
        if(!empty($frontPageIndex)) {
            unset($site_context['frontPageIndex']);
            Flags::set( 'import_design_index', $frontPageIndex );
        }
		Flags::set($this->getIsDismissedFlag(), true);
		Flags::set('aiSettings', $site_context);
		Flags::set('auto_start_black_wizard_onboarding', true);
		Flags::set('import_design', true);
		wp_send_json_success();
	}

	function get_industry_list()
	{
		$industry_list_folder_path = get_template_directory() . '/resources/industries';
		if (!is_dir($industry_list_folder_path)) {
			return [];
		}
		$files = scandir($industry_list_folder_path);
		$languages_available = [];
		foreach ($files as $file) {

			//only check json files
			if (strpos($file, 'json') === false) {
				continue;
			}
			$parts = explode('.', $file);
			$languages_available[] = $parts[0];
		}
		$admin_language = $this->get_admin_language();

		$language_to_load = null;
		if (in_array($admin_language, $languages_available)) {
			$language_to_load = $admin_language;
		} else {
			$language_to_load = 'en_US';
		}
		$industry_file_path = "$industry_list_folder_path/$language_to_load.json";
		if (!file_exists($industry_file_path)) {
			return [];
		}

		$json_content = file_get_contents($industry_file_path);
		$data = json_decode($json_content, true);
		return $data;
	}

	function get_admin_language()
	{
		$admin_language = get_user_locale();
		$base_language = (explode("_", $admin_language))[0];
		switch ($base_language) {
				//don't care for language variations use one for all to generate fewer items
			case 'en':
				$admin_language = 'en_US';
				break;
			case 'es':
				$admin_language = 'es_ES';
				break;
			case 'fr':
				$admin_language = 'fr_FR';
				break;
			case 'pt':
				$admin_language = 'pt_BR';
				break;
			case 'zh':
				$admin_language = 'zh_CN';
				break;
		}

		return $admin_language;
	}

	function get_default_color_scheme()
	{
		$colors = Defaults::get('colors');
		$default_colors = array();
		$allowed_keys = ['kubio-color-1', 'kubio-color-2', 'kubio-color-3', 'kubio-color-4', 'kubio-color-5', 'kubio-color-6'];
		$is_valid = true;
		foreach ($allowed_keys as $key) {
			if (!isset($colors[$key])) {
				$is_valid = false;
				break;
			}
			$value = $colors[$key];
			list($r, $g, $b) = $value;
			$default_colors[] = [
				'slug' => $key,
				'color' => [$r, $g, $b]
			];
		}
		if (!$is_valid) {
			return null;
		}


		return $default_colors;
	}

	function get_default_typography()
	{
		$typography_preset = Defaults::get('typographyPreset');
		return $typography_preset;
	}

	function register_onboarding_panel($wp_customize)
	{

		$wp_customize->add_panel(
			new AiOnboardingPanel(
				$wp_customize,
				'ai-onboarding-panel',
				array(
					'capability' => 'manage_options',
					'priority'   => 0,
					'type'       => 'colibri-panel',
				)
			)
		);
	}
	function get_js_data()
	{
		$settings = [
			'aiOnboardingNonce' => wp_create_nonce('ai_onboarding_nonce'),
			'themePrefix'                => Theme::prefix('', false),
			'defaultColorScheme'	=> $this->get_default_color_scheme(),
			'defaultFontFamilies' => $this->get_default_typography(),
			'kubioPluginStatus' => Theme::getInstance()->getPluginsManager()->getPluginState('kubio'),
			'aiLanguages' => $this->get_ai_content_languages(),
			'adminLanguage' => $this->get_admin_language(),
			'industryList' => $this->get_industry_list()
		];

		return $settings;
	}
	function register_onboarding_panel_resources()
	{
		ReactAssetsRegistry::enqueueAssetGroup('black-wizard');

		$settings = $this->get_js_data();
		wp_add_inline_script(
			'jquery',
			sprintf(
				'window.kubioUtilsDataCustomizer = %s;',
				wp_json_encode($settings)
			)
		);
	}



	function get_ai_content_languages()
	{
		return array(
			'ar_AR' => 'العربية (Arabic)',
			'az_AZ' => 'Azərbaycan dili (Azerbaijani)',
			'bn_BD' => 'বাংলা (Bengali)',
			'cs_CZ' => 'Čeština (Czech)',
			'cy_GB' => 'Cymraeg (Welsh)',
			'da_DK' => 'Dansk (Danish)',
			'de_DE' => 'Deutsch (German)',
			'el_GR' => 'Ελληνικά (Greek)',
			'en_US' => 'English US',
			'en_GB' => 'English GB (United Kingdom English)',
			'en_AU' => 'English AU (Australian English)',
			'en_CA' => 'English CA (Canadian English)',
			'es_ES' => 'Español (Spanish)',
			'es_MX' => 'Español MX (Mexican Spanish)',
			'et_EE' => 'Eesti keel (Estonian)',
			'fa_IR' => 'فارسی (Persian)',
			'fi_FI' => 'Suomi (Finnish)',
			'fr_FR' => 'Français (French)',
			'fr_CA' => 'Français CA (Canadian French)',
			'ga_IE' => 'Gaeilge (Irish)',
			'he_IL' => 'עברית (Hebrew)',
			'hi_IN' => 'हिन्दी (Hindi)',
			'hr_HR' => 'Hrvatski (Croatian)',
			'hu_HU' => 'Magyar (Hungarian)',
			'hy_AM' => 'Հայերեն (Armenian)',
			'id_ID' => 'Bahasa Indonesia (Indonesian)',
			'is_IS' => 'Íslenska (Icelandic)',
			'it_IT' => 'Italiano (Italian)',
			'ja_JP' => '日本語 (Japanese)',
			'ka_GE' => 'ქართული (Georgian)',
			'kk_KZ' => 'Қазақ тілі (Kazakh)',
			'ko_KR' => '한국어 (Korean)',
			'lt_LT' => 'Lietuvių kalba (Lithuanian)',
			'lv_LV' => 'Latviešu valoda (Latvian)',
			'ms_MY' => 'Bahasa Melayu (Malay)',
			'nb_NO' => 'Norsk bokmål (Norwegian Bokmål)',
			'nl_NL' => 'Nederlands (Dutch)',
			'pl_PL' => 'Polski (Polish)',
			'pt_PT' => 'Português (Portuguese)',
			'pt_BR' => 'Português BR (Portuguese Brasil)',
			'ro_RO' => 'Română (Romanian)',
			'ru_RU' => 'Русский (Russian)',
			'sk_SK' => 'Slovenčina (Slovak)',
			'sl_SI' => 'Slovenščina (Slovenian)',
			'sq_AL' => 'Shqip (Albanian)',
			'sr_RS' => 'Српски (Serbian)',
			'sv_SE' => 'Svenska (Swedish)',
			'ta_IN' => 'தமிழ் (Tamil)',
			'th_TH' => 'ไทย (Thai)',
			'tr_TR' => 'Türkçe (Turkish)',
			'uk_UA' => 'Українська (Ukrainian)',
			'ur_PK' => 'اردو (Urdu)',
			'vi_VN' => 'Tiếng Việt (Vietnamese)',
			'zh_CN' => '中文 (Chinese Simplified)',
			'zh_TW' => '中文 (Chinese Traditional)',
		);
	}
}
