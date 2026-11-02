<?php
namespace Kubio\AI;

use IlluminateAgnostic\Arr\Support\Arr;
use Kubio\Core\Importer;

class PostImage {

	static $images_by_keword = array();
	static $used_images      = array();
	public static function get_featured_image_from_keywords( $keywords ) {
		$image_url = self::get_image_from_api( $keywords );

		if ( $image_url ) {
			$image = Importer::importRemoteFile(
				$image_url
			);

			if ( $image ) {
				return $image['id'];
			}
		}

		return false;
	}

	private static function get_image_from_api( $keywords ) {
		$cached_images = Arr::get( static::$images_by_keword, $keywords );
		if ( $cached_images && is_array( $cached_images ) && count( $cached_images ) > 0 ) {
			$next_image = array_shift( $cached_images );
			while ( in_array( $next_image, static::$used_images ) && count( $cached_images ) > 0 ) {
				$next_image = array_shift( $cached_images );
			}
			Arr::set( static::$images_by_keword, $keywords, $cached_images );
			return $next_image;
		}
		$per_page   = 5;
		$image      = kubio_ai_call_api(
			'v1/search-media',
			array(
				'type'        => 'image',
				'search'      => $keywords,
				'per_page'    => $per_page,
				'orientation' => 'landscape',
				'size'        => 'small',
				'width'       => '1152',
				'height'      => '896',
			)
		);
		$images     = Arr::get( $image, 'content.items', array() );
		$next_image = null;
		if ( is_array( $images ) && count( $images ) > 0 ) {
			$next_image = array_shift( $images );
			while ( in_array( $next_image, static::$used_images ) && count( $images ) > 0 ) {
				$next_image = array_shift( $images );
			}
			static::$used_images[] = $next_image;
			Arr::set( static::$images_by_keword, $keywords, $images );
		}

		return $next_image;
	}
}
