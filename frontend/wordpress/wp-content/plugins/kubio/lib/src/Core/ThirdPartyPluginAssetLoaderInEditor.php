<?php

namespace Kubio\Core;



/**
 * For some plugins we want to load panels that are found in the default editor like for yoast/rank math so we load assets from the page
 * in gutenberg
 */
class ThirdPartyPluginAssetLoaderInEditor
{

	public $pluginsConfigs = [];


	private static $instance = null;



	protected function __construct()
	{
		add_action('admin_print_scripts', array($this, 'printAssetsList'), 20);
		add_action('wp_print_scripts', array($this, 'printAssetsList'), 20);
		add_action('kubio/editor/enqueue_assets', array($this, 'dequeuePluginAssetsInKubioEditor'), 20);
		add_action('enqueue_block_editor_assets', array($this, 'dequeueKubioScriptsInIframeRequest'), 9999);
	}


	//to not cause weird issues
	public function dequeueKubioScriptsInIframeRequest() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if (!isset($_GET['kubio-get-3rd-party-plugin-assets'])) {
			return;
		}
		global $wp_scripts, $wp_styles;

		foreach ($wp_scripts->queue as $handle) {
			if ($this->getScriptIsFromTargetPlugin($handle, 'kubio')) {
				wp_dequeue_script($handle);
			}
		}

	}


	public static function addPlugin($pluginPathSearchString, $isActiveCallback, $shouldDequeueAssets = false)
	{
		$config = [
			'pluginPathSearchString' => $pluginPathSearchString,
			'isActiveCallback' => $isActiveCallback,
			'shouldDequeueAssets' => $shouldDequeueAssets
		];
		static::getInstance()->pluginsConfigs[] = $config;
	}

	public function dequeuePluginAssetsInKubioEditor()
	{
		foreach ($this->pluginsConfigs as $config) {
			$currentPluginPathSearchString = $config['pluginPathSearchString'];
			$isActiveCallback = $config['isActiveCallback'];
			$shouldDequeueAssets = $config['shouldDequeueAssets'];

			if(!$shouldDequeueAssets) {
				continue;
			}

			$isActive = call_user_func($isActiveCallback);
			if (!$isActive) {
				return;
			}
			global $wp_scripts, $wp_styles;

			foreach ($wp_scripts->queue as $handle) {
				if ($this->getScriptIsFromTargetPlugin($handle, $currentPluginPathSearchString)) {
					wp_dequeue_script($handle);
				}
			}

			foreach ($wp_styles->queue as $handle) {
				if ($this->getStyleIsFromTargetPlugin($handle, $currentPluginPathSearchString)) {
					wp_dequeue_style($handle);
				}
			}
		}
	}
	public function printAssetsList()
	{
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if (!isset($_GET['kubio-get-3rd-party-plugin-assets'])) {
			return;
		}

		//search for a part of the plugin folder name in the url to find assets
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$pluginPathSearch =  sanitize_text_field( wp_unslash($_GET['kubio-get-3rd-party-plugin-assets'] ) )  ;
		global $wp_scripts;


		foreach ($this->pluginsConfigs as $config) {
			$currentPluginPathSearchString = $config['pluginPathSearchString'];
			$isActiveCallback = $config['isActiveCallback'];

			$isActive = call_user_func($isActiveCallback);
			if (!$isActive || $currentPluginPathSearchString !== $pluginPathSearch) {
				continue;
			}


			$pluginScriptsHandles = [];

			foreach ($wp_scripts->queue as $handle) {
				if (!$this->getScriptIsFromTargetPlugin($handle, $pluginPathSearch)) {
					continue;
				}

				$pluginScriptsHandles[] = $handle;
			}
			$dependencies = $this->getAllScriptDependencies($pluginScriptsHandles);


			wp_print_inline_script_tag(
				sprintf('window.kubioThirdParthyPluginsAssets = window.kubioThirdParthyPluginsAssets || {};
                       window.kubioThirdParthyPluginsAssets["%s"] = %s;', wp_kses_post($pluginPathSearch), wp_json_encode($dependencies))
			);
		}
	}

	public function getAllScriptDependencies($pluginScriptsHandles)
	{
		$collected = [];
		$this->getAllScriptDependenciesRecursive($pluginScriptsHandles, $collected);
		$singleArrayDeps = [];
		foreach ($collected as $key => $value) {
			$singleArrayDeps[] = $key;
			$singleArrayDeps = array_merge(array(), $singleArrayDeps, $value);
		};
		$singleArrayDeps = array_values(array_unique($singleArrayDeps));
		return $singleArrayDeps;
	}

	public function getAllScriptDependenciesRecursive($handles, &$collected = [])
	{
		global $wp_scripts;

		foreach ($handles as $handle) {
			// Skip if already processed
			if (isset($collected[$handle])) {
				continue;
			}

			// Store the handle
			$collected[$handle] = !empty($wp_scripts->registered[$handle]->deps) ? $wp_scripts->registered[$handle]->deps : [];

			// Recursively get dependencies of dependencies
			if (!empty($collected[$handle])) {
				$collected = $this->getAllScriptDependenciesRecursive($collected[$handle], $collected);
			}
		}

		return $collected;
	}

	public function getScriptIsFromTargetPlugin($handle, $pluginPathSearch)
	{
		global $wp_scripts;
		if (!isset($wp_scripts->registered[$handle])) {
			return false;
		}
		$reqistered_script = $wp_scripts->registered[$handle];
		$src = $reqistered_script->src;
		$path_to_search = "plugins/$pluginPathSearch";
		return strpos($src, $path_to_search) !== false;
	}
	public function getStyleIsFromTargetPlugin($handle, $pluginPathSearch)
	{
		global $wp_styles;
		if (!isset($wp_styles->registered[$handle])) {
			return false;
		}
		$reqistered = $wp_styles->registered[$handle];
		$src = $reqistered->src;
		$path_to_search = "plugins/$pluginPathSearch";
		return strpos($src, $path_to_search) !== false;
	}
	public static function getInstance()
	{
		if (! self::$instance) {
			self::$instance = new self();
		}

		return self::$instance;
	}

	public static function load()
	{
		return static::getInstance();
	}
}
