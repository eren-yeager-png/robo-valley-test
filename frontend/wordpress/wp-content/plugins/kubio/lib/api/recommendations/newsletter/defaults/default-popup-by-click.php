<?php

return array(
	'type'               => 'simple-popup',
	'template'           => '36',
	'triggers'           =>
		array(
			'exit-intent'             =>
				array(
					'checkbox' => 'false',
				),
			'after-inactivity'        =>
				array(
					'checkbox' => 'false',
				),
			'time-spent-on-page'      =>
				array(
					'checkbox' => 'false',
				),
			'time-spent-on-site'      =>
				array(
					'checkbox' => 'false',
				),
			'total-view-products'     =>
				array(
					'checkbox' => 'false',
				),
			'product-in-cart'         =>
				array(
					0          => '',
					'checkbox' => '0',
				),
			'total-number-in-cart'    =>
				array(
					'checkbox' => 'false',
				),
			'on-click'                =>
				array(
					0          => 'class',
					'checkbox' => 'false',
				),
			'scroll-percent'          =>
				array(
					'checkbox' => 'false',
				),
			'scroll-to-element'       =>
				array(
					0          => 'class',
					'checkbox' => 'false',
				),
			'page-load'               =>
				array(
					0          => '0',
					'checkbox' => 'false',
				),
			'page-views'              =>
				array(
					'checkbox' => 'false',
				),
			'new-returning'           =>
				array(
					0          => 'all',
					'checkbox' => 'true',
				),
			'x-sessions'              =>
				array(
					'checkbox' => 'false',
				),
			'specific-traffic-source' =>
				array(
					0          => '',
					'checkbox' => 'false',
				),
			'specific-utm'            =>
				array(
					'checkbox' => 'false',
				),
			'location'                =>
				array(
					0          => '',
					2          => 'browser',
					'checkbox' => 'false',
				),
		),
	'display_conditions' =>
		array(
			'start-time' => '',
			'end-time'   => '',
			'devices'    =>
				array(
					0 => 'desktop',
					1 => 'mobile',
					2 => 'tablet',
				),
			'pages'      =>
				array(
					0 => 'all',
				),
			'recurring'  =>
				array(
					'converted' =>
						array(
							'when'  => 'always',
							'delay' => '1',
							'unit'  => 'd',
						),
					'closed'    =>
						array(
							'when'  => 'always',
							'delay' => '1',
							'unit'  => 'd',
						),
				),
		),

);
