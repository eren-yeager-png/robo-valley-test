<?php
// RoboValley Projects: LOCAL-ONLY demo content. Run with WP-CLI:
//   WP_ENVIRONMENT_TYPE=local wp eval-file rvprojects-demo-data.php create     (add the demo projects)
//   WP_ENVIRONMENT_TYPE=local wp eval-file rvprojects-demo-data.php remove     (delete them again)
//
// Not part of the plugin: the plugin never creates projects. This file lives under frontend/dev-tools/ and is not
// shipped in the plugin zip. Every project it creates has a title that starts with "DEMO " and a short description that starts
// with "DEMO: ", plus the post meta _rvp_demo = 1, so they can be recognised and removed. The restricted fields say
// they are demo text as well. It REFUSES to run unless WP_ENVIRONMENT_TYPE is explicitly "local" or "development"
// (production, staging and an unset value are all refused).

if ( ! defined( 'RVP_POST_TYPE' ) ) {
	WP_CLI::error( 'RoboValley Projects is not active.' );
}
$env = wp_get_environment_type();
if ( ! defined( 'WP_ENVIRONMENT_TYPE' ) && false === getenv( 'WP_ENVIRONMENT_TYPE' ) ) {
	WP_CLI::error( 'WP_ENVIRONMENT_TYPE is not set, so this site is treated as production. Refusing to create demo data.' );
}
if ( ! in_array( $env, array( 'local', 'development' ), true ) ) {
	WP_CLI::error( "Environment type is '$env'. Demo data may only be created when it is 'local' or 'development'. Refusing." );
}
$action = isset( $args[0] ) ? $args[0] : 'create';

global $wpdb;
if ( 'remove' === $action ) {
	$ids = $wpdb->get_col( "SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = '_rvp_demo' AND meta_value = '1'" );
	foreach ( $ids as $id ) { wp_delete_post( (int) $id, true ); }
	WP_CLI::success( 'Removed ' . count( $ids ) . ' demo projects.' );
	return;
}
if ( 'create' !== $action ) {
	WP_CLI::error( 'Use "create" or "remove".' );
}
if ( (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->postmeta} WHERE meta_key = '_rvp_demo'" ) > 0 ) {
	WP_CLI::error( 'Demo projects already exist. Run "remove" first.' );
}

$demo = array(
	array( 'Line-Following Robot', 'robotics', array( 'class-6-10' ), 'beginner', array( 'physics', 'electronics' ), true, 'A small car that follows a black line using two infrared sensors.', array( 'Basic wiring', 'Reading sensor values' ), array( 'Arduino Uno', '2 IR sensors', 'Motor driver', '2 DC motors' ), 'A robot that completes a looped track on its own.' ),
	array( 'Obstacle-Avoiding Rover', 'robotics', array( 'class-6-10', 'intermediate' ), 'beginner', array( 'physics', 'computer-science' ), false, 'An ultrasonic sensor lets a rover steer around objects.', array( 'Arduino basics', 'Simple loops' ), array( 'Arduino Uno', 'Ultrasonic sensor', 'Chassis kit' ), 'A rover that drives for a minute without bumping into anything.' ),
	array( 'Smart Plant Watering System', 'iot', array( 'intermediate', 'iti' ), 'intermediate', array( 'electronics', 'computer-science' ), true, 'Soil moisture readings start a pump and are sent to a phone.', array( 'Microcontroller programming', 'Wi-Fi basics' ), array( 'ESP32', 'Soil moisture sensor', 'Relay and pump' ), 'Plants watered automatically, with a daily report.' ),
	array( 'Weather Station Dashboard', 'iot', array( 'polytechnic', 'b-tech' ), 'intermediate', array( 'physics', 'computer-science' ), false, 'Temperature, humidity and pressure are logged and charted.', array( 'Sensor interfacing', 'Data logging' ), array( 'ESP32', 'BME280 sensor', 'Breadboard' ), 'A live chart of local weather readings.' ),
	array( 'Voice-Controlled Home Switch', 'embedded-systems', array( 'polytechnic' ), 'intermediate', array( 'electronics', 'electrical-engineering' ), false, 'Switch a lamp on and off with simple spoken commands.', array( 'C programming', 'Relay safety' ), array( 'Microcontroller board', 'Voice module', 'Relay board' ), 'A lamp that responds to three voice commands.' ),
	array( 'Digit Recognition with a Small Neural Network', 'artificial-intelligence', array( 'b-tech', 'postgraduate' ), 'advanced', array( 'mathematics', 'computer-science' ), true, 'Train a tiny network to read hand-written digits.', array( 'Python', 'Linear algebra' ), array( 'Laptop', 'Python with NumPy' ), 'A model that reads digits with over 95 percent accuracy.' ),
	array( 'Printable Gear Train', '3d-printing', array( 'class-6-10', 'intermediate' ), 'beginner', array( 'physics', 'mechanical-engineering' ), false, 'Design and print gears and see how ratios change speed.', array( 'CAD basics' ), array( '3D printer', 'PLA filament' ), 'A working gear train with a measured ratio.' ),
	array( 'Automated Sorting Conveyor', 'automation', array( 'iti', 'polytechnic' ), 'advanced', array( 'electrical-engineering', 'mechanical-engineering' ), false, 'A conveyor sorts small parts by colour.', array( 'PLC or microcontroller logic', 'Motor control' ), array( 'Conveyor kit', 'Colour sensor', 'Servo' ), 'Parts sorted into two bins automatically.' ),
	array( 'Quadcopter Flight Controller', 'drone-technology', array( 'b-tech', 'postgraduate' ), 'advanced', array( 'physics', 'electrical-engineering' ), true, 'Tune a stabilisation loop for a small quadcopter.', array( 'Control theory', 'Embedded C' ), array( 'Flight controller', 'Motors and ESCs', 'Frame' ), 'A drone that hovers steadily indoors.' ),
	array( 'LED Cube Animations', 'electronics', array( 'intermediate', 'iti' ), 'intermediate', array( 'electronics' ), false, 'A 4x4x4 cube of LEDs plays patterns.', array( 'Soldering', 'Multiplexing' ), array( '64 LEDs', 'Shift registers', 'Microcontroller' ), 'Ten different animations on a finished cube.' ),
	array( 'Science Fair Robot Arm', 'stem', array( 'class-6-10' ), 'beginner', array( 'physics', 'mechanical-engineering' ), false, 'A cardboard and syringe arm that lifts small objects.', array( 'Teamwork' ), array( 'Cardboard', 'Syringes and tubing' ), 'An arm that lifts a coin and drops it in a cup.' ),
	array( 'Solar Tracker', 'other-technologies', array( 'polytechnic', 'b-tech' ), 'intermediate', array( 'physics', 'electrical-engineering' ), false, 'A panel follows the sun to collect more energy.', array( 'Servo control', 'Light sensing' ), array( 'Solar panel', 'LDR sensors', 'Servo' ), 'Measured energy gain over a fixed panel.' ),
);
$n = 0; $base = time() - 3600 * 24;
foreach ( $demo as $i => $d ) {
	$id = wp_insert_post( array( 'post_type' => RVP_POST_TYPE, 'post_title' => 'DEMO ' . $d[0], 'post_status' => 'publish', 'post_date' => gmdate( 'Y-m-d H:i:s', $base + $i * 600 ) ), true );
	if ( is_wp_error( $id ) ) { WP_CLI::warning( $id->get_error_message() ); continue; }
	update_post_meta( $id, '_rvp_demo', '1' );
	update_post_meta( $id, '_rvp_short_desc', 'DEMO: ' . $d[6] );
	update_post_meta( $id, '_rvp_difficulty', $d[3] );
	if ( $d[5] ) { update_post_meta( $id, '_rvp_featured', '1' ); }
	update_post_meta( $id, '_rvp_order', (string) ( $i + 1 ) );
	update_post_meta( $id, '_rvp_overview', 'DEMO TEXT (not a real project). ' . $d[6] . ' This text only exists to test the members-only details window.' );
	update_post_meta( $id, '_rvp_skills', implode( "\n", $d[7] ) );
	update_post_meta( $id, '_rvp_components', implode( "\n", $d[8] ) );
	update_post_meta( $id, '_rvp_outcome', 'DEMO: ' . $d[9] );
	wp_set_object_terms( $id, array( $d[1] ), RVP_TAX_TECH );
	wp_set_object_terms( $id, $d[2], RVP_TAX_EDU );
	wp_set_object_terms( $id, $d[4], RVP_TAX_SUBJECT );
	$n++;
}
WP_CLI::success( "Created $n DEMO projects. Every title starts with 'DEMO ' and every description with 'DEMO: '. Remove them with: wp eval-file rvprojects-demo-data.php remove" );
