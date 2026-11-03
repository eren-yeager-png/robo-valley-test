<?php
namespace Kubio\Ai;

use Kubio\Core\Importer;
use IlluminateAgnostic\Arr\Support\Arr;

class ShopContent {
	public static function save_products_categories( $categories = array() ) {
		$saved_categories = array();
		if ( ! empty( $categories ) ) {
			foreach ( $categories as  $category ) {
				$category_title = Arr::get( $category, 'title' );
				$image_keywords = Arr::get( $category, 'keywords' );

				$saved_category = static::create_category(
					array(
						'title'          => $category_title,
						'image_keywords' => $image_keywords,
					)
				);

				if ( $saved_category ) {
					$saved_categories[] = $saved_category;
				}
			}
		}

		return $saved_categories;
	}
	public static function save_products_by_category( $products = array(), $category_id = 0 ) {
		$posts = array();
		if ( ! empty( $products ) ) {
			foreach ( $products as  $product ) {
				$post_id = self::create_product(
					array(
						'title'         => $product['title'],
						'imageKeywords' => $product['imageKeywords'],
						'imageURL'      => $product['imageURL'],
						'category_id'   => $category_id,
					)
				);

				if ( ! is_wp_error( $post_id ) ) {
					$posts[] = $post_id;
				}
			}
		}
		return $posts;
	}

	public static function create_category( $category_details = array() ) {
		$saved_category = null;

		$category_title = Arr::get( $category_details, 'title' );
		$image_keywords = Arr::get( $category_details, 'image_keywords' );

		$existing_category = term_exists( $category_title, 'product_cat' );
		if ( $existing_category ) {
			$saved_category = get_term( $existing_category['term_id'], 'product_cat' );
		} else {
			$term_result = wp_insert_term(
				$category_title, // the term
				'product_cat'  // the taxonomy
			);
			if ( is_wp_error( $term_result ) ) {
				return null;
			}
			$term_id = $term_result['term_id'];
			$term    = get_term( $term_id, 'product_cat' );
			if ( $image_keywords ) {
				$attach_id = PostImage::get_featured_image_from_keywords(
					$image_keywords
				);

				if ( $attach_id ) {
					update_term_meta( $term_id, 'thumbnail_id', $attach_id );
				}
			}

			$saved_category = $term;
		}
		if ( ! empty( $saved_category ) ) {
			return array(
				'id'   => $saved_category->term_id,
				'name' => $saved_category->name,
				'link' => get_term_link( $saved_category->term_id ),
			);
		} else {
			return null;
		}
	}

	public static function create_product( $product_details = array() ) {
		$product = new \WC_Product_Simple();

		$product->set_name( $product_details['title'] ); // product title

		$product->set_slug( sanitize_title( $product_details['title'] ) );

		// random price
		$regular_price = \wp_rand( 10, 300 );
		$product->set_regular_price( $regular_price ); // in current shop currency

		$product->set_sale_price( $regular_price * 0.75 );

		$product->set_short_description(
			self::generate_ipsum(
				wp_rand( 1, 2 )
			)
		);
		$product->set_description(
			self::generate_ipsum(
				wp_rand( 5, 8 )
			)
		);

		$attach_id = null;

		if ( isset( $product_details['imageURL'] ) && $product_details['imageURL'] ) {
			$image = Importer::importRemoteFile(
				$product_details['imageURL']
			);

			if ( $image ) {
				$attach_id = $image['id'];
			}
		}

		if ( ! $attach_id ) {
			$attach_id = PostImage::get_featured_image_from_keywords(
				$product_details['imageKeywords']
			);
		}

		if ( $attach_id ) {
			$product->set_image_id( $attach_id );
		}

		$product->set_featured( true );
		$product->set_category_ids( array( $product_details['category_id'] ) );

		$product->add_meta_data( '_kubio_created_product', 1 );
		$product->save();

		return $product->get_id();
	}

	public static function generate_ipsum( $paragraphs = 6 ) {
		$faker = \Faker\Factory::create();
		// faker lorem
		return $faker->paragraphs( $paragraphs, true );
	}
}
