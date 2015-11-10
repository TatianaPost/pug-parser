'use strict';

var assert = require('assert');
var path = require('path');
var TokenStream = require('token-stream');
var inlineTags = require('./lib/inline-tags');

var extname = path.extname;

module.exports = parse;
module.exports.Parser = Parser;
function parse(tokens, filename) {
  var parser = new Parser(tokens, filename);
  var ast = parser.parse();
  return JSON.parse(JSON.stringify(ast));
};

/**
 * Initialize `Parser` with the given input `str` and `filename`.
 *
 * @param {String} str
 * @param {String} filename
 * @param {Object} options
 * @api public
 */

function Parser(tokens, filename){
  this.tokens = new TokenStream(tokens);
  this.filename = filename;
  this.inMixin = 0;
};

/**
 * Parser prototype.
 */

Parser.prototype = {

  /**
   * Save original constructor
   */

  constructor: Parser,

  error: function (message, code, token) {
    var err = new Error(message + ' on line ' + token.line + ' of ' + this.filename);
    err.code = 'JADE:' + code;
    err.msg = message;
    err.line = token.line;
    err.filename = this.filename;
    throw err;
  },

  /**
   * Return the next token object.
   *
   * @return {Object}
   * @api private
   */

  advance: function(){
    return this.tokens.advance();
  },

  /**
   * Single token lookahead.
   *
   * @return {Object}
   * @api private
   */

  peek: function() {
    return this.tokens.peek();
  },

  /**
   * `n` token lookahead.
   *
   * @param {Number} n
   * @return {Object}
   * @api private
   */

  lookahead: function(n){
    return this.tokens.lookahead(n);
  },

  /**
   * Parse input returning a string of js for evaluation.
   *
   * @return {String}
   * @api public
   */

  parse: function(){
    var block = this.emptyBlock(0);

    while ('eos' != this.peek().type) {
      if ('newline' == this.peek().type) {
        this.advance();
      } else if ('text-html' == this.peek().type) {
        block.nodes = block.nodes.concat(this.parseTextHtml());
      } else {
        var next = this.peek();
        var expr = this.parseExpr();
        if (expr) block.nodes.push(expr);
      }
    }

    return block;
  },

  /**
   * Expect the given type, or throw an exception.
   *
   * @param {String} type
   * @api private
   */

  expect: function(type){
    if (this.peek().type === type) {
      return this.advance();
    } else {
      this.error('expected "' + type + '", but got "' + this.peek().type + '"', 'INVALID_TOKEN', this.peek());
    }
  },

  /**
   * Accept the given `type`.
   *
   * @param {String} type
   * @api private
   */

  accept: function(type){
    if (this.peek().type === type) {
      return this.advance();
    }
  },

  initBlock: function(line, nodes) {
    /* istanbul ignore if */
    if ((line | 0) !== line) throw new Error('`line` is not an integer');
    /* istanbul ignore if */
    if (!Array.isArray(nodes)) throw new Error('`nodes` is not an array');
    return {
      type: 'Block',
      nodes: nodes,
      line: line,
      filename: this.filename
    };
  },

  emptyBlock: function(line) {
    return this.initBlock(line, []);
  },

  /**
   *   tag
   * | doctype
   * | mixin
   * | include
   * | filter
   * | comment
   * | text
   * | text-html
   * | dot
   * | each
   * | code
   * | yield
   * | id
   * | class
   * | interpolation
   */

  parseExpr: function(){
    switch (this.peek().type) {
      case 'tag':
        return this.parseTag();
      case 'mixin':
        return this.parseMixin();
      case 'block':
        return this.parseBlock();
      case 'mixin-block':
        return this.parseMixinBlock();
      case 'case':
        return this.parseCase();
      case 'extends':
        return this.parseExtends();
      case 'include':
        return this.parseInclude();
      case 'doctype':
        return this.parseDoctype();
      case 'filter':
        return this.parseFilter();
      case 'comment':
        return this.parseComment();
      case 'text':
      case 'interpolated-code':
      case 'start-jade-interpolation':
        return this.parseText({block: true});
      case 'text-html':
        return this.initBlock(this.peek().line, this.parseTextHtml());
      case 'dot':
        return this.parseDot();
      case 'each':
        return this.parseEach();
      case 'code':
        return this.parseCode();
      case 'blockcode':
        return this.parseBlockCode();
      case 'if':
        return this.parseConditional();
      case 'while':
        return this.parseWhile();
      case 'call':
        return this.parseCall();
      case 'interpolation':
        return this.parseInterpolation();
      case 'yield':
        return this.parseYield();
      case 'id':
      case 'class':
        this.tokens.defer({
          type: 'tag',
          val: 'div',
          line: this.peek().line,
          filename: this.filename
        });
        return this.parseExpr();
      default:
        this.error('unexpected token "' + this.peek().type + '"', 'INVALID_TOKEN', this.peek());
    }
  },

  parseDot: function() {
    this.advance();
    return this.parseTextBlock();
  },

  /**
   * Text
   */

  parseText: function(options){
    var tags = [];
    var lineno = this.peek().line;
    var tokType = this.peek().type;
    loop:
      while (true) {
        switch (tokType) {
          case 'text':
            var tok = this.advance();
            tags.push({
              type: 'Text',
              val: tok.val,
              line: tok.line,
              filename: this.filename
            });
            break;
          case 'interpolated-code':
            var tok = this.advance();
            tags.push({
              type: 'Code',
              val: tok.val,
              buffer: tok.buffer,
              mustEscape: tok.mustEscape !== false,
              isInline: true,
              line: tok.line,
              filename: this.filename
            });
            break;
          case 'newline':
            if (!options || !options.block) break loop;
            var tok = this.advance();
            if (this.peek().type === 'text') {
              tags.push({
                type: 'Text',
                val: '\n',
                line: tok.line,
                filename: this.filename
              });
            }
            break;
          case 'start-jade-interpolation':
            this.advance();
            tags.push(this.parseExpr());
            this.expect('end-jade-interpolation');
            break;
          default:
            break loop;
        }
        tokType = this.peek().type;
      }
    if (tags.length === 1) return tags[0];
    else return this.initBlock(lineno, tags);
  },

  parseTextHtml: function () {
    var nodes = [];
    var currentNode = null;
    while (this.peek().type === 'text-html') {
      var text = this.advance();
      if (!currentNode) {
        currentNode = {
          type: 'Text',
          val: text.val,
          filename: this.filename,
          line: text.line,
          isHtml: true
        };
        nodes.push(currentNode);
      } else {
        currentNode.val += '\n' + text.val;
      }
      if (this.peek().type === 'indent') {
        var block = this.block();
        block.nodes.forEach(function (node) {
          if (node.isHtml) {
            if (!currentNode) {
              currentNode = node;
              nodes.push(currentNode);
            } else {
              currentNode.val += '\n' + node.val;
            }
          } else {
            currentNode = null;
            nodes.push(node);
          }
        });
      } else if (this.peek().type === 'newline') {
        this.advance();
      }
    }
    return nodes;
  },

  /**
   *   ':' expr
   * | block
   */

  parseBlockExpansion: function(){
    var tok = this.accept(':');
    if (tok) {
      return this.initBlock(tok.line, [this.parseExpr()]);
    } else {
      return this.block();
    }
  },

  /**
   * case
   */

  parseCase: function(){
    var tok = this.expect('case');
    var node = {type: 'Case', expr: tok.val, line: tok.line, filename: this.filename};

    var block = this.emptyBlock(tok.line + 1);
    this.expect('indent');
    while ('outdent' != this.peek().type) {
      switch (this.peek().type) {
        case 'comment':
        case 'newline':
          this.advance();
          break;
        case 'when':
          block.nodes.push(this.parseWhen());
          break;
        case 'default':
          block.nodes.push(this.parseDefault());
          break;
        default:
          this.error('Unexpected token "' + this.peek().type
                          + '", expected "when", "default" or "newline"', 'INVALID_TOKEN', this.peek());
      }
    }
    this.expect('outdent');

    node.block = block;

    return node;
  },

  /**
   * when
   */

  parseWhen: function(){
    var tok = this.expect('when');
    if (this.peek().type !== 'newline') {
      return {
        type: 'When',
        expr: tok.val,
        block: this.parseBlockExpansion(),
        debug: false,
        line: tok.line,
        filename: this.filename
      };
    } else {
      return {
        type: 'When',
        expr: tok.val,
        debug: false,
        line: tok.line,
        filename: this.filename
      };
    }
  },

  /**
   * default
   */

  parseDefault: function(){
    var tok = this.expect('default');
    return {
      type: 'When',
      expr: 'default',
      block: this.parseBlockExpansion(),
      debug: false,
      line: tok.line,
      filename: this.filename
    };
  },

  /**
   * code
   */

  parseCode: function(noBlock){
    var tok = this.expect('code');
    assert(typeof tok.mustEscape === 'boolean', 'Please update to the newest version of jade-lexer.');
    var node = {
      type: 'Code',
      val: tok.val,
      buffer: tok.buffer,
      mustEscape: tok.mustEscape !== false,
      isInline: !!noBlock,
      line: tok.line,
      filename: this.filename
    };
    // todo: why is this here?  It seems like a hacky workaround
    if (node.val.match(/^ *else/)) node.debug = false;

    if (noBlock) return node;

    var block;

    // handle block
    block = 'indent' == this.peek().type;
    if (block) {
      if (tok.buffer) {
        this.error('Buffered code cannot have a block attached to it', 'BLOCK_IN_BUFFERED_CODE', this.peek());
      }
      node.block = this.block();
    }

    return node;
  },
  parseConditional: function(){
    var tok = this.expect('if');
    var node = {
      type: 'Conditional',
      test: tok.val,
      consequent: this.emptyBlock(tok.line),
      alternate: null,
      line: tok.line,
      filename: this.filename
    };

    // handle block
    if ('indent' == this.peek().type) {
      node.consequent = this.block();
    }

    var currentNode = node;
    while (true) {
      if (this.peek().type === 'newline') {
        this.expect('newline');
      } else if (this.peek().type === 'else-if') {
        tok = this.expect('else-if');
        currentNode = (
          currentNode.alternate = {
            type: 'Conditional',
            test: tok.val,
            consequent: this.emptyBlock(tok.line),
            alternate: null,
            line: tok.line,
            filename: this.filename
          }
        );
        if ('indent' == this.peek().type) {
          currentNode.consequent = this.block();
        }
      } else if (this.peek().type === 'else') {
        this.expect('else');
        if (this.peek().type === 'indent') {
          currentNode.alternate = this.block();
        }
        break;
      } else {
        break;
      }
    }

    return node;
  },
  parseWhile: function(){
    var tok = this.expect('while');
    var node = {
      type: 'While',
      test: tok.val,
      line: tok.line,
      filename: this.filename
    };

    // handle block
    if ('indent' == this.peek().type) {
      node.block = this.block();
    } else {
      node.block = this.emptyBlock(tok.line);
    }

    return node;
  },

  /**
   * block code
   */

  parseBlockCode: function(){
    var line = this.expect('blockcode').line;
    var node;
    var body = this.peek();
    var text = '';
    if (body.type === 'start-pipeless-text') {
      this.advance();
      while (this.peek().type !== 'end-pipeless-text') {
        var tok = this.advance();
        switch (tok.type) {
          case 'text':
            text += tok.val;
            break;
          case 'newline':
            text += '\n';
            break;
          default:
            this.error('Unexpected token type: ' + tok.type, 'INVALID_TOKEN', tok);
        }
      }
      this.advance();
    }
    return {
      type: 'Code',
      val: text,
      buffer: false,
      mustEscape: false,
      isInline: false,
      line: line,
      filename: this.filename
    };
  },
  /**
   * comment
   */

  parseComment: function(){
    var tok = this.expect('comment');
    var block;
    if (block = this.parseTextBlock()) {
      return {
        type: 'BlockComment',
        val: tok.val,
        block: block,
        buffer: tok.buffer,
        line: tok.line,
        filename: this.filename
      };
    } else {
      return {
        type: 'Comment',
        val: tok.val,
        buffer: tok.buffer,
        line: tok.line,
        filename: this.filename
      };
    }
  },

  /**
   * doctype
   */

  parseDoctype: function(){
    var tok = this.expect('doctype');
    return {
      type: 'Doctype',
      val: tok.val,
      line: tok.line,
      filename: this.filename
    };
  },

  parseIncludeFilter: function() {
    var tok = this.expect('filter');
    var attrs = [];

    if (this.peek().type === 'start-attributes') {
      attrs = this.attrs();
    }

    return {
      type: 'IncludeFilter',
      name: tok.val,
      attrs: attrs,
      line: tok.line,
      filename: this.filename
    };
  },

  /**
   * filter attrs? text-block
   */

  parseFilter: function(){
    var tok = this.expect('filter');
    var block, attrs = [];

    if (this.peek().type === 'start-attributes') {
      attrs = this.attrs();
    }

    if (this.peek().type === 'text') {
      var textToken = this.advance();
      block = this.initBlock(textToken.line, [
        {
          type: 'Text',
          val: textToken.val,
          line: textToken.line,
          filename: this.filename
        }
      ]);
    } else if (this.peek().type === 'filter') {
      block = this.initBlock(tok.line, [this.parseFilter()]);
    } else {
      block = this.parseTextBlock() || this.emptyBlock(tok.line);
    }

    return {
      type: 'Filter',
      name: tok.val,
      block: block,
      attrs: attrs,
      line: tok.line,
      filename: this.filename
    };
  },

  /**
   * each block
   */

  parseEach: function(){
    var tok = this.expect('each');
    var node = {
      type: 'Each',
      obj: tok.code,
      val: tok.val,
      key: tok.key,
      block: this.block(),
      line: tok.line,
      filename: this.filename
    };
    if (this.peek().type == 'else') {
      this.advance();
      node.alternate = this.block();
    }
    return node;
  },

  /**
   * 'extends' name
   */

  parseExtends: function(){
    var tok = this.expect('extends');
    var path = this.expect('path');
    return {
      type: 'Extends',
      file: {
        type: 'FileReference',
        path: path.val.trim(),
        line: tok.line,
        filename: this.filename
      },
      line: tok.line,
      filename: this.filename
    };
  },

  /**
   * 'block' name block
   */

  parseBlock: function(){
    var tok = this.expect('block');

    var node = 'indent' == this.peek().type ? this.block() : this.emptyBlock(tok.line);
    node.type = 'NamedBlock';
    node.name = tok.val.trim();
    node.mode = tok.mode;
    node.line = tok.line;

    return node;
  },

  parseMixinBlock: function () {
    var tok = this.expect('mixin-block');
    if (!this.inMixin) {
      this.error('Anonymous blocks are not allowed unless they are part of a mixin.', 'BLOCK_OUTISDE_MIXIN', tok);
    }
    return {type: 'MixinBlock', line: tok.line, filename: this.filename};
  },

  parseYield: function() {
    var tok = this.expect('yield');
    return {type: 'YieldBlock', line: tok.line, filename: this.filename};
  },

  /**
   * include block?
   */

  parseInclude: function(){
    var tok = this.expect('include');
    var node = {
      type: 'Include',
      file: {
        type: 'FileReference',
        line: tok.line,
        filename: this.filename
      },
      line: tok.line,
      filename: this.filename
    };
    var filters = [];
    while (this.peek().type === 'filter') {
      filters.push(this.parseIncludeFilter());
    }
    var path = this.expect('path');

    node.file.path = path.val.trim();

    if (/\.jade$/.test(node.file.path)) {
      node.block = 'indent' == this.peek().type ? this.block() : this.emptyBlock(tok.line);
      if (filters.length) {
        // TODO: make this a warning
        // this.error('Jade inclusion cannot be filtered; filters ignored', 'JADE_INCLUDE_FILTER', path);
      }
    } else {
      node.type = 'RawInclude';
      node.filters = filters;
      if (this.peek().type === 'indent') {
        // If there is a block, just ignore it.
        this.block();
        // TODO: make this a warning
        // this.error('Raw inclusion cannot contain a block; block ignored', 'RAW_INCLUDE_BLOCK', this.peek());
      }
    }
    return node;
  },

  /**
   * call ident block
   */

  parseCall: function(){
    var tok = this.expect('call');
    var name = tok.val;
    var args = tok.args;
    var mixin = {
      type: 'Mixin',
      name: name,
      args: args,
      block: this.emptyBlock(tok.line),
      call: true,
      attrs: [],
      attributeBlocks: [],
      line: tok.line,
      filename: this.filename
    };

    this.tag(mixin);
    if (mixin.code) {
      mixin.block.nodes.push(mixin.code);
      delete mixin.code;
    }
    if (mixin.block.nodes.length === 0) mixin.block = null;
    return mixin;
  },

  /**
   * mixin block
   */

  parseMixin: function(){
    var tok = this.expect('mixin');
    var name = tok.val;
    var args = tok.args;

    // definition
    if ('indent' == this.peek().type) {
      this.inMixin++;
      var mixin = {
        type: 'Mixin',
        name: name,
        args: args,
        block: this.block(),
        call: false,
        line: tok.line,
        filename: this.filename
      };
      this.inMixin--;
      return mixin;
    // call
    } else {
      console.warn('Deprecated method of calling mixins, use `+name` syntax (' +
                   this.filename + ' line ' + tok.line + ')');
      return {
        type: 'Mixin',
        name: name,
        args: args,
        block: this.emptyBlock(tok.line),
        call: true,
        attrs: [],
        attributeBlocks: [],
        line: tok.line,
        filename: this.filename
      };
    }
  },

  /**
   * indent (text | newline)* outdent
   */

  parseTextBlock: function(){
    var tok = this.accept('start-pipeless-text');
    if (!tok) return;
    var block = this.emptyBlock(tok.line);
    while (this.peek().type !== 'end-pipeless-text') {
      var tok = this.advance();
      switch (tok.type) {
        case 'text':
          block.nodes.push({type: 'Text', val: tok.val, line: tok.line});
          break;
        case 'newline':
          block.nodes.push({type: 'Text', val: '\n', line: tok.line});
          break;
        case 'start-jade-interpolation':
          block.nodes.push(this.parseExpr());
          this.expect('end-jade-interpolation');
          break;
        case 'interpolated-code':
          block.nodes.push({
            type: 'Code',
            val: tok.val,
            buffer: tok.buffer,
            mustEscape: tok.mustEscape !== false,
            isInline: true,
            line: tok.line,
            filename: this.filename
          });
          break;
        default:
          this.error('Unexpected token type: ' + tok.type, 'INVALID_TOKEN', tok);
      }
    }
    this.advance();
    return block;
  },

  /**
   * indent expr* outdent
   */

  block: function(){
    var tok = this.expect('indent');
    var block = this.emptyBlock(tok.line);
    while ('outdent' != this.peek().type) {
      if ('newline' == this.peek().type) {
        this.advance();
      } else if ('text-html' == this.peek().type) {
        block.nodes = block.nodes.concat(this.parseTextHtml());
      } else {
        var expr = this.parseExpr();
        block.nodes.push(expr);
      }
    }
    this.expect('outdent');
    return block;
  },

  /**
   * interpolation (attrs | class | id)* (text | code | ':')? newline* block?
   */

  parseInterpolation: function(){
    var tok = this.advance();
    var tag = {
      type: 'InterpolatedTag',
      expr: tok.val,
      selfClosing: false,
      block: this.emptyBlock(tok.line),
      attrs: [],
      attributeBlocks: [],
      isInline: false,
      line: tok.line,
      filename: this.filename
    };

    return this.tag(tag, {selfClosingAllowed: true});
  },

  /**
   * tag (attrs | class | id)* (text | code | ':')? newline* block?
   */

  parseTag: function(){
    var tok = this.advance();
    var tag = {
      type: 'Tag',
      name: tok.val,
      selfClosing: false,
      block: this.emptyBlock(tok.line),
      attrs: [],
      attributeBlocks: [],
      isInline: inlineTags.indexOf(tok.val) !== -1,
      line: tok.line,
      filename: this.filename
    };

    return this.tag(tag, {selfClosingAllowed: true});
  },

  /**
   * Parse tag.
   */

  tag: function(tag, options) {
    var seenAttrs = false;
    var attributeNames = [];
    var selfClosingAllowed = options && options.selfClosingAllowed;
    // (attrs | class | id)*
    out:
      while (true) {
        switch (this.peek().type) {
          case 'id':
          case 'class':
            var tok = this.advance();
            if (tok.type === 'id') {
              if (attributeNames.indexOf('id') !== -1) {
                this.error('Duplicate attribute "id" is not allowed.', 'DUPLICATE_ID', tok);
              }
              attributeNames.push('id');
            }
            tag.attrs.push({
              name: tok.type,
              val: "'" + tok.val + "'",
              mustEscape: false
            });
            continue;
          case 'start-attributes':
            if (seenAttrs) {
              console.warn(this.filename + ', line ' + this.peek().line + ':\nYou should not have jade tags with multiple attributes.');
            }
            seenAttrs = true;
            tag.attrs = tag.attrs.concat(this.attrs(attributeNames));
            continue;
          case '&attributes':
            var tok = this.advance();
            tag.attributeBlocks.push(tok.val);
            break;
          default:
            break out;
        }
      }

    // check immediate '.'
    if ('dot' == this.peek().type) {
      tag.textOnly = true;
      this.advance();
    }

    // (text | code | ':')?
    switch (this.peek().type) {
      case 'text':
      case 'interpolated-code':
        var text = this.parseText();
        if (text.type === 'Block') {
          tag.block.nodes.push.apply(tag.block.nodes, text.nodes);
        } else {
          tag.block.nodes.push(text);
        }
        break;
      case 'code':
        tag.block.nodes.push(this.parseCode(true));
        break;
      case ':':
        this.advance();
        tag.block = this.initBlock(tag.line, [this.parseExpr()]);
        break;
      case 'newline':
      case 'indent':
      case 'outdent':
      case 'eos':
      case 'start-pipeless-text':
      case 'end-jade-interpolation':
        break;
      case 'slash':
        if (selfClosingAllowed) {
          this.advance();
          tag.selfClosing = true;
          break;
        }
      default:
        this.error('Unexpected token `' + this.peek().type + '` expected `text`, `interpolated-code`, `code`, `:`' + (selfClosingAllowed ? ', `slash`' : '') + ', `newline` or `eos`', 'INVALID_TOKEN', this.peek())
    }

    // newline*
    while ('newline' == this.peek().type) this.advance();

    // block?
    if (tag.textOnly) {
      tag.block = this.parseTextBlock() || this.emptyBlock(tag.line);
    } else if ('indent' == this.peek().type) {
      var block = this.block();
      for (var i = 0, len = block.nodes.length; i < len; ++i) {
        tag.block.nodes.push(block.nodes[i]);
      }
    }

    return tag;
  },

  attrs: function(attributeNames) {
    this.expect('start-attributes');

    var attrs = [];
    var tok = this.advance();
    while (tok.type === 'attribute') {
      if (tok.name !== 'class' && attributeNames) {
        if (attributeNames.indexOf(tok.name) !== -1) {
          this.error('Duplicate attribute "' + tok.name + '" is not allowed.', 'DUPLICATE_ATTRIBUTE', tok);
        }
        attributeNames.push(tok.name);
      }
      attrs.push({
        name: tok.name,
        val: tok.val,
        mustEscape: tok.mustEscape !== false
      });
      tok = this.advance();
    }
    this.tokens.defer(tok);
    this.expect('end-attributes');
    return attrs;
  }
};
