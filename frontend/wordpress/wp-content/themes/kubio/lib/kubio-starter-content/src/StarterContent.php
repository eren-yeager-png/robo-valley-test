<?php

namespace Kubio\StarterContent;

use ColibriWP\Theme\Core\Hooks;
use ColibriWP\Theme\Core\Utils;
use ColibriWP\Theme\Defaults;
use ColibriWP\Theme\Translations;
use Kubio\Theme\Flags;

class StarterContent {

	const HOME_SLUG  = 'home';
	const BLOG_SLUG  = 'blog';
	const ABOUT_SLUG = 'about';
	const CONTACT    = 'contact';

	// singleton
	private static $_instance = null;

	public static function instance() {
		if ( is_null( self::$_instance ) ) {
			self::$_instance = new self();
		}
		return self::$_instance;
	}

	public static function init() {
		return self::instance();
	}

	private function __construct() {
		add_filter( 'pre_option_kubio-onboarding-notice-disabled', '__return_true' );
		add_action( 'after_setup_theme', array( $this, 'init_starter_content' ) );
		add_action( 'customize_post_value_set_page_on_front', array( $this, 'customize_post_value_set_page_on_front' ), 10, 1 );
		add_action( 'post_updated', array( $this, 'after_post_update' ), 10, 1 );
		add_filter( 'kubio/activation/activate_with_frontpage', array( $this, 'kubio_activate_with_frontpage' ), 100, 1 );
		Hooks::prefixed_add_action( 'after_plugin_activated', array( $this, 'after_plugin_activated' ), 5 );
		add_action( 'kubio/after_activation', array( $this, 'after_kubio_plugin_activated' ), 500 );

		add_action( 'customize_save', array( $this, 'customize_on_save' ) );

		$this->init_theme_json_and_styles_theme_support();
	}

	public function customize_on_save( $wp_customize ) {
		if ( get_option( 'fresh_site' ) ) {
			Flags::set( 'with_starter_content', true );
            $stylesheet = get_stylesheet();
            Flags::set( "with_starter_content_$stylesheet", true );
		}
	}

	public function init_theme_json_and_styles_theme_support() {
		add_theme_support( 'custom-spacing' );
		add_theme_support( 'align-wide' );
		add_theme_support( 'align-full' );
		add_theme_support( 'border' );
		add_theme_support( 'shadow' );
		add_theme_support( 'link-color' );
		add_theme_support( 'appearance-tools' );

		add_theme_support( 'editor-color-palette', $this->get_theme_pallete() );

		add_theme_support(
			'editor-font-sizes',
			array(
				array(
					'name' =>  'Small',
					'size' => '0.777em',
					'slug' => 'small',
				),
				array(
					'name' =>'Medium',
					'size' => '0.888em',
					'slug' => 'medium',
				),
				array(
					'name' =>  'Large',
					'size' => '2em',
					'slug' => 'large',
				),
				array(
					'name' =>  'Extra Large',
					'size' => '2.5em',
					'slug' => 'x-large',
				),
				array(
					'name' => 'Extra Extra Large',
					'size' => '3em',
					'slug' => 'xx-large',
				),
			)
		);

		add_filter('wp_theme_json_data_theme', array($this, 'add_shadow_presets_to_theme_json'));
		// add_theme_support( 'wp-block-styles' );
	}

	/**
	 *
	 * @param \WP_Theme_JSON_Data $theme_json_data
	 * @return void
	 */
	public function add_shadow_presets_to_theme_json($theme_json_data)
	{
		$theme_json_data->update_with(
			array(
				'version' => 2,
				'settings' => array(
					'shadow' => array(
						// 'defaultPresets' => true,
						"presets" => array(
							array(
								'name'   => 'Deep 2',
								'shadow' => '0px 0px 50px rgba(0, 0, 0, 0.2)',
								'slug'   => 'deep-2',
							),
						)
					)
				)
			)
		);

		return $theme_json_data;
	}

	public function init_theme_json_and_styles() {
		add_filter( 'wp_theme_json_data_theme', array( $this, 'add_extras_to_theme_json' ) );

		$stylesheet_directory = get_stylesheet_directory();
		$template_directory   = get_template_directory();

		// This is the same as get_theme_file_path(), which isn't available in load-styles.php context
		if ( $stylesheet_directory !== $template_directory && file_exists( $stylesheet_directory . '/theme.json' ) ) {
			$theme_json_path = $stylesheet_directory . '/theme.json';
		} else {
			$theme_json_path = $template_directory . '/theme.json';
		}

		if ( ! file_exists( $theme_json_path ) ) {
			add_filter(
				'theme_file_path',
				array( $this, 'filter_theme_file_path' ),
				10,
				2
			);
		}

	}

	public function init_starter_content() {

		// if ( apply_filters( 'kubio_is_enabled', false ) ) {
		// 	add_filter( 'kubio/block_editor_settings', array( $this, 'add_kubio_settings' ) );
		// 	return;
		// }

		add_theme_support( 'editor-styles' );
		add_editor_style( './resources/google-fonts/style.css' );

		$stylesheet_directory = get_stylesheet_directory();
		$template_directory   = get_template_directory();

		$editor_style_rel = 'resources/editor-style.css';

		if ( $stylesheet_directory !== $template_directory && file_exists( $stylesheet_directory . '/' . $editor_style_rel ) ) {
			$editor_style_abs = $stylesheet_directory . '/' . $editor_style_rel;
		} else {
			$editor_style_abs = $template_directory . '/' . $editor_style_rel;
		}

		if ( file_exists( $editor_style_abs ) ) {
			add_editor_style( "./$editor_style_rel" );
		}

		$starter_content = $this->get_content();
		if ( ! $starter_content ) {
			return;
		}

		add_theme_support( 'starter-content', $starter_content );
		add_action( 'customize_preview_init', array( $this, 'customize_preview_init' ) );
	}

	public function add_kubio_settings( $settings ) {

		$css_file  = get_template_directory() . '/resources/theme/fse-base-style.css';
		$fse_style = file_get_contents( $css_file );

		$color_overrides_css = '';

		if ( ! apply_filters( 'kubio/overrides-core-color', false ) ) {
			$theme_json = \WP_Theme_JSON_Resolver::get_theme_data()->get_raw_data();
			$palette    = Utils::pathGet( $theme_json, 'settings.color.palette.theme', array() );

			$color_overrides_css = '.entry-content { ';
			foreach ( $palette as $color ) {
				$color_overrides_css .= "--wp--preset--color--{$color['slug']}: rgb(var(--{$color['slug']})) !important; ";
			}
			$color_overrides_css .= '}';
		}

		$settings['styles'] = array_merge(
			$settings['styles'],
			array(
				array(
					'css'            => $fse_style,
					'__unstableType' => 'presets',
				),
				array(
					'css'            => $color_overrides_css,
					'__unstableType' => 'presets',
				),
			)
		);

		return $settings;
	}

	private function normalize_page_data( $page, $slug ) {

		$post_content = isset( $page['post_content'] ) ? $page['post_content'] : '';
		$template     = isset( $page['template'] ) ? $page['template'] : '';

		if ( empty( $post_content ) ) {
			$post_content = $this->get_content_for_slug( $slug );
		}

		if ( $slug === StarterContent::HOME_SLUG ) {
			$template = 'home-page.php';
		}

		return array(
			'post_type'    => 'page',
			'post_title'   => isset( $page['post_title'] ) ? $page['post_title'] : '',
			'post_content' => $post_content,
			'template'     => $template,
		);
	}

	private function get_content() {
		$prefix = get_template();

		$pages = apply_filters(
			'kubio_starter_content_pages',
			array()
		);

		if ( empty( $pages ) ) {
			return false;
		}

		$menu_items = array();
		$posts      = array();

		foreach ( $pages as $key => $page ) {
			$in_menu = isset( $page['in_menu'] ) ? $page['in_menu'] : true;

			$posts[ "{$prefix}-{$key}" ] = $this->normalize_page_data( $page, $key );
			if ( $in_menu ) {
				$menu_items[ "{$prefix}-{$key}" ] = array(
					'type'      => 'post_type',
					'object'    => 'page',
					'object_id' => '{{' . "{$prefix}-{$key}" . '}}',
				);
			}
		}

		$starter_content = array(
			'posts'     => $posts,
			'nav_menus' => array(
				'header-menu' => array(
					'items' => $menu_items,
				),
			),
			'options'   => array(
				'show_on_front'                          => 'page',
				'page_on_front'                          => '{{' . "{$prefix}-" . self::HOME_SLUG . '}}',
				'page_for_posts'                         => '{{' . "{$prefix}-" . self::BLOG_SLUG . '}}',
				'__kubio-theme-starter-content-imported' => true,
			),
		);

		return $starter_content;
	}

	private function get_content_for_slug( $path ) {

		static $contents = array();

		if ( ! isset( $contents[ $path ] ) ) {

			ob_start();
			locate_template( 'starter-content/' . $path . '.php', true );
			$content = ob_get_clean();

			$blocks = parse_blocks( $content );
			$prefix = get_template();

			// for each block add a custom class like : $prefix-starter-content-section
			$section_class = $prefix . '-starter-content-section';
			$extra_classes = implode( ' ', array( $section_class /*'with-kubio-global-style'*/ ) );

			foreach ( $blocks as $key => $block ) {

				if ( ! $block['blockName'] ) {
					continue;
				}

				$old_class_name              = Utils::pathGet( $block, 'attrs.className', '' );
				$block['attrs']['className'] = $old_class_name . ' ' . $extra_classes;

				$p = new \WP_HTML_Tag_Processor( $block['innerHTML'] );

				if ( $p->next_tag() ) {
					$old_class_name = $p->get_attribute( 'class' );
					$p->set_attribute( 'class', $old_class_name . ' ' . $extra_classes );
					$block['innerHTML'] = $p->get_updated_html();
				}

				foreach ( $block['innerContent'] as $index => $inner_content ) {

					if ( ! $inner_content ) {
						continue;
					}

					$p = new \WP_HTML_Tag_Processor( $inner_content );

					if ( $p->next_tag() ) {
						$old_class_name = $p->get_attribute( 'class' );
						$p->set_attribute( 'class', $old_class_name . ' ' . $extra_classes );
						$block['innerContent'][ $index ] = $p->get_updated_html();
					}
				}

				$blocks[ $key ] = $block;
			}

			$next_content = serialize_blocks( $blocks );
			$next_content = preg_replace( "#\n\s+#", ' ', $next_content );

			$contents[ $path ] = $next_content;

		}

		return $contents[ $path ];
	}


	public function filter_theme_file_path( $path, $file ) {
		if ( $file === 'theme.json' ) {
			return realpath( __DIR__ . '/../scripts/theme-json.base.json' );
		}
		return $path;
	}

	public function get_theme_pallete() {
		$colors = Defaults::get( 'colors' );

		$palette = array();
		$index   = 0;
		foreach ( $colors as $color => $value ) {
			if ( str_contains( $color, 'variant' ) ) {
				continue;
			}

			list( $r, $g, $b ) = $value;
			$index++;
			$palette[] = array(
				'slug'  => $color,
				'name'  => sprintf( 'Color %d', $index ),
				'color' => sprintf( 'rgb(%s, %s, %s)', $r, $g, $b ),
			);
		}

		$color_5_var_2_label = Translations::get( 'color5_variant2_label' );

		if ( $color_5_var_2_label === '__[color5_variant2_label]__' ) {
			$color_5_var_2_label = 'Color 5 Variant 2';
		}

		$palette[] = array(
			'slug'  => 'kubio-color-5-variant-2',
			'name'  => $color_5_var_2_label,
			'color' => '#F9F9F9',
		);

		return $palette;
	}
	/**
	 *
	 * @param \WP_Theme_JSON_Data $theme_json_data
	 * @return void
	 */
	public function add_extras_to_theme_json( $theme_json_data ) {

		$palette = $this->get_theme_pallete();

		$theme_json_data->update_with(
			array(
				'version'  => 2,
				'settings' => array(
					'color' => array(
						'palette' => $palette,
					),
				),

			)
		);

		return $theme_json_data;
	}



	public function customize_preview_init() {
		$uri_base = get_template_directory_uri() . '/lib/kubio-starter-content/scripts';
		wp_enqueue_script( 'kubio-starter-content-customize-preview', $uri_base . '/customize-preview.js', array( 'customize-preview' ), null, true );
		wp_enqueue_style( 'kubio-starter-content-customize-preview', $uri_base . '/customize-preview.css' );

		add_action(
			'wp_footer',
			function() {

				wp_add_inline_script(
					'kubio-starter-content-customize-preview',
					sprintf(
						'jQuery(()=>{ window.kubioStarterContentPreview(%s) } );',
						wp_json_encode(
							array(
								'sectionClass' => get_template() . '-starter-content-section',
								'texts'        => array(
									'primaryButtonLabel'   => Translations::get( 'customize_preview_overlay_button_1' ),
									'secondaryButtonLabel' => Translations::get( 'customize_preview_overlay_button_2' ),
									'message'              => Translations::get( 'customize_preview_overlay_message', 'Kubio' ),
									'install'              => Translations::get( 'installing', 'Kubio' ),
									'activate'             => Translations::get( 'activating', 'Kubio' ),
								),
								'isFrontPage'  => is_front_page() && ! is_home(),
							)
						)
					)
				);

			}
		);

		wp_add_inline_style(
			'kubio-starter-content-customize-preview',
			sprintf(
				'.%1$s { position: relative; } ' .
				'.%1$s:hover > .kubio-starter-edit-overlay { z-index: 100000; opacity: 1; pointer-events: auto; }',
				get_template() . '-starter-content-section'
			)
		);

		$css = '';

		$style = apply_filters(
			'kubio_starter_content_overlay_style',
			array(
				'background' => 'rgb(82, 70, 241, 0.9)',
				'transition' => 'opacity 0.3s ease',
				'button-1'   => array(
					'normal' => array(
						'background' => '#fff',
						'color'      => 'rgba(82, 70, 241, 1)',
						'border'     => '#fff',
					),
					'hover'  => array(
						'background' => 'rgba(82, 70, 241, 0.2)',
						'color'      => '#fff',
						'border'     => 'rgba(82, 70, 241, 0.2)',
					),
				),
				'button-2'   => array(
					'normal' => array(
						'background' => 'rgba(82, 70, 241, 0.2)',
						'color'      => '#fff',
						'border'     => 'rgba(82, 70, 241, 0.2)',
					),
					'hover'  => array(
						'background' => '#fff',
						'color'      => 'rgba(82, 70, 241, 1)',
						'border'     => '#fff',
					),

				),
			)
		);

		$css .= "--background-color: {$style['background']};";
		$css .= "--transition: {$style['transition']};";

		$css .= "--button-1-background-color: {$style['button-1']['normal']['background']};";
		$css .= "--button-1-color: {$style['button-1']['normal']['color']};";
		$css .= "--button-1-border-color: {$style['button-1']['normal']['border']};";

		$css .= "--button-1-hover-background-color: {$style['button-1']['hover']['background']};";
		$css .= "--button-1-hover-color: {$style['button-1']['hover']['color']};";
		$css .= "--button-1-hover-border-color: {$style['button-1']['hover']['border']};";

		$css .= "--button-2-background-color: {$style['button-2']['normal']['background']};";
		$css .= "--button-2-color: {$style['button-2']['normal']['color']};";
		$css .= "--button-2-border-color: {$style['button-2']['normal']['border']};";

		$css .= "--button-2-hover-background-color: {$style['button-2']['hover']['background']};";
		$css .= "--button-2-hover-color: {$style['button-2']['hover']['color']};";
		$css .= "--button-2-hover-border-color: {$style['button-2']['hover']['border']};";

		$css = sprintf( '.kubio-starter-edit-overlay:not(#undefined) { %s }', $css );

		wp_add_inline_style(
			'kubio-starter-content-customize-preview',
			$css
		);
	}


	/**
	 * Set a custom meta value for the front page, so we can track if the user has modified it. Kubio Builder will handle the case when the user has not modified the front page.
	 * @param mixed $name
	 * @return void
	 */
	public function customize_post_value_set_page_on_front( $value ) {

		if ( get_option( 'fresh_site' ) && is_numeric( $value ) ) {
			$meta_name = '_kubio_front_starter_content';
			update_post_meta( $value, $meta_name, 'yes', get_post_meta( $value, $meta_name, true ) );
		}

	}

	/**
	 * Remove the meta value for the front page, so we can track if the user has modified it. Kubio Builder will handle the case when the user has not modified the front page.
	 *
	 * @param int $id
	 * @return void
	 */
	public function after_post_update( $id ) {

		if ( intval( $id ) !== intval( get_option( 'page_on_front' ) ) ) {
			return;
		}

		$meta_name = '_kubio_front_starter_content';
		if ( 'yes' === get_post_meta( $id, $meta_name, true ) ) {
			delete_post_meta( $id, $meta_name );
		}
	}

	public function kubio_activate_with_frontpage( $activate ) {

		static $has_unmodified_fp = null;

		if ( $has_unmodified_fp === null ) {
			$page_on_front = intval( get_option( 'page_on_front' ) );
			$meta_name     = '_kubio_front_starter_content';
			$meta          = get_post_meta( $page_on_front, $meta_name, true );
			if ( $meta === 'yes' ) {
				$has_unmodified_fp = true;
				add_filter( 'kubio/activation/override_front_page_content',  '__return_true');
				add_filter( 'kubio/activation/force_front_page_creation',  '__return_false', 100);
			}
		}

		return $activate || $has_unmodified_fp;
	}

	public function is_starter_content_source() {
		$source          = Flags::get( 'start_source', 'other' );
		$allowed_sources = array( 'starter-content-overlay', 'starter-content-sidebar' );

		return in_array( $source, $allowed_sources, true );
	}

	public function after_plugin_activated() {

		if ( $this->is_starter_content_source() ) {
			$customizer_section_action = sanitize_text_field( Utils::pathGet( $_REQUEST, 'payload.section_action', '' ) );
			$customizer_section_id     = sanitize_text_field( Utils::pathGet( $_REQUEST, 'payload.section_id', '' ) );

			if ( empty( $customizer_section_action ) || empty( $customizer_section_id ) ) {
				return;
			}

			Flags::set(
				'kubio_starter_content_section_action',
				array(
					'action' => $customizer_section_action,
					'id'     => $customizer_section_id,
				)
			);
		}

	}


	private function get_redirect_url() {
		$section_action = Flags::get( 'kubio_starter_content_section_action', array() );

		$args = array(
			'page'           => 'kubio',
			'section_action' => Utils::pathGet( $section_action, 'action' ),
			'section_id'     => Utils::pathGet( $section_action, 'id' ),
		);

		$url = add_query_arg(
			$args,
			admin_url( 'admin.php' )
		);

		return $url;
	}

	public function after_kubio_plugin_activated() {
        if(Flags::get( 'auto_start_black_wizard_onboarding', false )) {
            return;
        }
		if ( $this->is_starter_content_source() ) {
			$section_action = Flags::get( 'kubio_starter_content_section_action' );

			if ( empty( $section_action ) ) {
				return;
			}

			wp_redirect( $this->get_redirect_url() );
			exit();
		}

		if ( Flags::get( 'with_starter_content', false ) ) {
			$url = add_query_arg(
				array(
					'page' => 'kubio',
				),
				admin_url( 'admin.php' )
			);
			wp_redirect( $url );
			exit();
		}
	}
}
