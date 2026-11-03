<?php

namespace Kubio\Theme;

trait Singleton {

	protected static $instance;

	/**
	 * Get the singleton instance
	 *
	 * @return static
	 */
	public static function getInstance() {
		return isset( static::$instance )
			? static::$instance
			: static::$instance = new static();
	}

	/**
	 * Load singleton
	 *
	 * @return static
	 */
	public static function load() {
		return static::getInstance();
	}
}
