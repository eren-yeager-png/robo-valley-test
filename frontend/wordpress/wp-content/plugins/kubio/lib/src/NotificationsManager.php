<?php

namespace Kubio;

use DateTime;

class NotificationsManager {

	private static $remote_data_url_base = 'https://kubiobuilder.com/wp-json/wp/v2/notification';

	private static $plugins_to_install = array();

	public static function load() {
		add_action( 'admin_init', array( NotificationsManager::class, 'init' ) );
		if ( ! wp_next_scheduled( NotificationsManager::class . '::onSchedule' ) ) {
			wp_schedule_event( time(), 'twicedaily', NotificationsManager::class . '::onSchedule' );
		}
		add_action(NotificationsManager::class . '::onSchedule', NotificationsManager::class . '::onSchedule' );
	}

	/**
	 * Checks if this WordPress instances is declared as a development environment.
	 * Relies on the `KUBIO_NOTIFICATIONS_DEV_MODE` constant.
	 *
	 * @return bool
	 */
	private static function isDevMode() {
		return ( defined( 'KUBIO_NOTIFICATIONS_DEV_MODE' ) && KUBIO_NOTIFICATIONS_DEV_MODE );
	}

	/**
	 * Verifies the data and displays remote notifications accordingly.
	 *
	 * @return void
	 */
	public static function init() {

		// check if we have cached data in transient
		$notifications = get_transient( static::getTransientKey() );

		if ( $notifications === false || self::isDevMode() ) {
			// No notifications, try to get them from remote and cache them.
			static::prepareRetrieveRemoteNotifications();
		}

		static::displayNotifications( $notifications );

		add_action('admin_footer', array( NotificationsManager::class, 'printNoticePluginInstallScript' ) );

		add_action( 'wp_ajax_kubio-remote-notifications-retrieve', array( NotificationsManager::class, 'updateNotificationsData' ) );
	}

	public static function onSchedule() {
		// check if we have cached data in transient
		$notifications = get_transient( static::getTransientKey() );

		if ( $notifications === false || self::isDevMode() ) {
			// No notifications, try to get them from remote and cache them.
			static::callNotificationsEndpoint();
		}
	}

	/**
	 * Adds a JavaScript code which fetches notifications asynchronously.
	 *
	 * @return void
	 */
	public static function prepareRetrieveRemoteNotifications() {

		add_action(
			'admin_footer',
			function () {
				$fetch_url = add_query_arg(
					array(
						'action'   => 'kubio-remote-notifications-retrieve',
						'_wpnonce' => wp_create_nonce( 'kubio-remote-notifications-retrieve-nonce' ),

					),
					admin_url( 'admin-ajax.php' )
				); ?>
					<script>
						window.fetch("<?php echo esc_url_raw( $fetch_url ); ?>")
					</script>
					<?php
			}
		);
	}

	/**
	 * Retrieves notifications and saves them in a transient.
	 *
	 * @return void
	 */
	public static function updateNotificationsData() {
		check_ajax_referer( 'kubio-remote-notifications-retrieve-nonce' );
		$done = static::callNotificationsEndpoint();
		wp_send_json_success( $done );

	}

	public static function callNotificationsEndpoint() {

		$url = add_query_arg(
			array(
				'_fields'             => 'acf,id',
				// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_key'            => 'license_type',
				// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
				'meta_value'          => apply_filters( 'kubio/notifications/license_type', 'free' ),
				'kubio_version'       => KUBIO_VERSION,
				'kubio_build'         => KUBIO_BUILD_NUMBER,
				'kubio_theme_version' => wp_get_theme()->get( 'Version' ),
				'template'            => get_template(),
				'stylesheet'          => get_stylesheet(),
				'source'              => Flags::get( 'start_source', 'other' ),
				'f'                   => Flags::get( 'kubio_f' ),
				'activated_on'        => Flags::get( 'kubio_activation_time', '' ),
				'pro_activated_on'    => Flags::get( 'kubio_pro_activation_time', '' ),
			),
			self::$remote_data_url_base
		);

		$data = wp_remote_get( $url );

		$code = wp_remote_retrieve_response_code( $data );
		$body = wp_remote_retrieve_body( $data );

		$posts = json_decode( $body, true );

		if ( $code !== 200 ) {
			wp_send_json_error( $code );
		}

		$notifications = array();

		foreach ( $posts as $post ) {
			$notifications[ $post['id'] ] = $post;
		}

		$done = set_transient( static::getTransientKey(), $notifications, DAY_IN_SECONDS );

		return $done;
	}

	/**
	 * Adds the stack of notifications for display using `kubio_add_dismissable_notice`.
	 *
	 * @param array $notifications
	 * @return void
	 */
	private static function displayNotifications( $notifications ) {

		if ( empty( $notifications ) ) {
			return;
		}

		foreach ( $notifications as $notification ) {
			$params       = $notification['acf'];
			$params['id'] = $notification['id'];

			if ( $params['dev'] === true && ! self::isDevMode() ) {
				continue;
			}

			if ( ! self::isTimeToDisplay( $params ) ) {
				continue;
			}

			if ( self::isPluginInstallNotice( $params ) && self::isPluginAlreadyInstalled( $params['plugin_slug'] ) ) {
				continue;
			}

			$classnames    = 'kubio-remote-notification';
			$allowed_types = array( 'info', 'warning', 'error', 'success' );

			if ( ! empty( $params['type'] ) && in_array( $params['type'], $allowed_types ) ) {
				$classnames .= ' notice-' . $params['type'] . ' kubio-remote-notification-' . $params['type'];
			}

			$notice_key = 'kubio-remote-notice-' . $params['id'];

			if ( self::isDevMode() ) {
				$notice_key .= '-' . time();
			}

			kubio_add_dismissable_notice(
				$notice_key,
				array( NotificationsManager::class, 'displayNotification' ),
				0,
				$params,
				$classnames
			);
		}
	}


	/**
	 * Whether the given notification is a plugin-install notice.
	 * Relies on the dedicated `is_plugin_install` / `plugin_slug` ACF fields.
	 *
	 * @param array $params Notification parameters.
	 * @return bool
	 */
	private static function isPluginInstallNotice( $params ) {
		return ! empty( $params['is_plugin_install'] ) && ! empty( $params['plugin_slug'] );
	}

	private static function isPluginAlreadyInstalled($plugin_slug){
		static $active_plugin_slugs = null;

		if($active_plugin_slugs === null){
			$active_plugin_paths = get_option( 'active_plugins' );
			$active_plugin_slugs = array_map('dirname', $active_plugin_paths);
		}
		return in_array($plugin_slug, $active_plugin_slugs);
	}

	/**
	 * Prints the HTML of a notification for the given params.
	 *
	 * @param $params
	 * @return void
	 */
	public static function displayNotification( $params ) {

		$args = array(
			'utm_theme'            => get_template(),
			'utm_childtheme'       => get_stylesheet(),
			'utm_install_source'   => Flags::get( 'start_source', 'other' ),
			'utm_activated_on'     => Flags::get( 'kubio_activation_time', '' ),
			'utm_pro_activated_on' => Flags::get( 'kubio_pro_activation_time', '' ),
			'utm_campaign'         => 'wp-notice',
			'utm_medium'           => 'wp',
		);

		wp_enqueue_script( 'wp-util' ); // make sure to enqueue the admin ajax functions

		$is_plugin_install = self::isPluginInstallNotice( $params );
		$plugin_slug       = $is_plugin_install ? $params['plugin_slug'] : '';
		$plugin_redirect   = $is_plugin_install && ! empty( $params['plugin_redirect'] ) ? $params['plugin_redirect'] : '';

		if ( $is_plugin_install ) {
			self::$plugins_to_install[ $plugin_slug ] = array(
				'slug'     => $plugin_slug,
				'label'    => $params['plugin_label'] ?? '',
				'redirect' => $plugin_redirect,
			);
		}

		$buttons_to_display = [
			'primary' => [
				'link' => $params['primary_link'] && isset($params['primary_link']['url']) ? add_query_arg( $args, $params['primary_link']['url'] ) : '',
				'text' => $params['primary_link'] && isset($params['primary_link']['title']) ? $params['primary_link']['title'] : '',
				'class' => 'kubio-remote-notification-primary',
				// The plugin install/activate flow is driven by the primary button.
				'plugin_slug'     => $plugin_slug,
				'plugin_redirect' => $plugin_redirect,
				'plugin_label'    => $is_plugin_install ? ( $params['plugin_label'] ?? '' ) : '',
			],
			'secondary' => [
				'link' => $params['secondary_link'] && isset($params['secondary_link']['url']) ? add_query_arg( $args, $params['secondary_link']['url'] ) : '',
				'text' => $params['secondary_link'] && isset($params['secondary_link']['title']) ? $params['secondary_link']['title'] : '',
				'class' => 'kubio-remote-notification-secondary',
				'plugin_slug'     => '',
				'plugin_redirect' => '',
				'plugin_label'    => '',
			]
		]

		?>
		<div
		    class="kubio-remote-notification-wrapper"
		    id="kubio-remote-notification-<?php echo esc_attr( $params['id'] ); ?>"
			<?php echo $is_plugin_install ? 'data-has-suggested-plugins="1"' : ''; ?>
		>
			<div class="kubio-remote-notification-icon">
				<?php
				// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
				echo wp_kses_post( KUBIO_LOGO_SVG );
				?>
			</div>
			<?php if ( ! empty( $params['message'] ) ) { ?>
				<div class="kubio-remote-notification-message">
				<?php
					// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
					echo wpautop( $params['message'] );
				?>
					</div>
			<?php } ?>
			<div class="kubio-remote-notification-buttons">
				<?php foreach($buttons_to_display as $button){ ?>
					<?php if(!empty($button['link']) && !empty($button['text'])){ ?>
						<a
							href="<?php echo esc_url( $button['link'] ); ?>"
							class="button button-large <?php echo esc_attr( $button['class'] ); ?>"
							<?php if(!empty($button['plugin_slug'])){ ?>
								data-suggested-plugin-slug="<?php echo esc_attr( $button['plugin_slug'] ); ?>"
								<?php if(!empty($button['plugin_redirect'])){ ?>
									data-plugin-redirect="<?php echo esc_url( $button['plugin_redirect'] ); ?>"
									data-plugin-label="<?php echo esc_attr( $button['plugin_label'] ); ?>"
								<?php } ?>
							<?php } ?>
						>
							<?php echo esc_html( $button['text'] ); ?>
						</a>
					<?php } ?>
				<?php } ?>
			</div>
		</div>
		<?php
	}

	public static function printNoticePluginInstallScript(){

		if(empty(static::$plugins_to_install)){
			return;
		}

		$plugins_states = array();
		foreach(array_keys(static::$plugins_to_install) as $plugin_slug){
			$plugins_states[ $plugin_slug ] = PluginsManager::getInstance()->getPluginStatus( $plugin_slug );
		}

		wp_enqueue_script('kubio-admin-area');
			$data = array(
				'ajax_url'       => admin_url( 'admin-ajax.php' ),
				'ajax_nonce'     => wp_create_nonce( 'kubio-ajax-demo-site-verification' ),
				'texts'          => array(
					'importing_template' => '%s',
					'plugins_states'     => array(
						'ACTIVE'        => esc_html__( 'Active', 'kubio' ),
						'INSTALLED'     => esc_html__( 'Installed', 'kubio' ),
						'NOT_INSTALLED' => esc_html__( 'Not Installed', 'kubio' ),
					),
					'import_stopped'     => esc_html__( 'Import stopped', 'kubio' ),
				),
				'plugins_states' => $plugins_states,
			);
			wp_add_inline_script(
				'kubio-admin-area',
				sprintf( 'kubio.adminArea.initNoticePluginInstall(%s)', wp_json_encode( $data ) ),
				'after'
			);
	}

	/**
	 * Verify if the notification checks the time requirements.
	 *
	 * @param array $params Notification parameters.
	 * @return bool
	 */
	private static function isTimeToDisplay( array $params ) {

		if ( $params['has_time_boundary'] === true ) {
			return self::inTimeBoundaries( $params['start_date'], $params['date_end'] );
		}

		$install_time = Flags::get( 'kubio_activation_time', time() );

		$install_time = apply_filters( 'kubio/notifications/install_time', $install_time );

		$show_after = strtotime( '+' . $params['after'] . ' days', $install_time );
		$time       = new DateTime( 'NOW' );

		if ( $show_after <= $time->getTimeStamp() ) {
			return true;
		}

		return false;
	}

	/**
	 * Checks if the current time is between a given $start and $end date.
	 * If $start or $end are null that generally means there is no restrain for that edge.
	 *
	 * @param $start
	 * @param $end
	 * @return bool
	 */
	private static function inTimeBoundaries( $start, $end ) {
		$time       = new DateTime( 'today' );
		$start_date = \DateTime::createFromFormat( 'Ymd', $start );

		if ( $start === null || $start_date && $start_date <= $time ) {
			$end_date = \DateTime::createFromFormat( 'Ymd', $end );

			if ( $end === null || $end_date && $time <= $end_date ) {
				return true;
			}
		}

		return false;
	}

	private static function getTransientKey() {
		$transient = apply_filters( 'kubio/notifications/transient_key', 'kubio_remote_notifications' );
		return $transient;
	}
}
