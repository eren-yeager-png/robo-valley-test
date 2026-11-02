<?php

use Kubio\Core\LodashBasic;
use Kubio\Core\ThirdPartyPluginAssetLoaderInEditor;
use Kubio\PluginsManager;
use function _\uniq;

function kubio_is_siteleads_plugin_active() {
	return class_exists( '\SiteLeads\Constants' );
}
function kubio_is_siteleads_pro_plugin_installed() {
	return PluginsManager::getInstance()->isPluginInstalled('siteleads-pro');
}
function kubio_is_siteleads_plugin_installed() {
	return PluginsManager::getInstance()->isPluginInstalled('siteleads') || kubio_is_siteleads_pro_plugin_installed();
}



function kubio_get_siteleads_widgets() {
	if(!kubio_is_siteleads_plugin_active()) {
		return [];
	}
	if ( ! class_exists( '\SiteLeads\Features\Widgets\FCWidgetsManager' )
		|| ! method_exists( '\SiteLeads\Features\Widgets\FCWidgetsManager', 'getWidgetListOptions' )) {
		return [];
	}

	return \SiteLeads\Features\Widgets\FCWidgetsManager::getWidgetListOptions();
}




